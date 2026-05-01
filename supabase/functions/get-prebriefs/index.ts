// get-prebriefs — structured context for meetings in the next 7 days.
//
// This is intentionally deterministic: no model calls, no generated prose.
// It gathers already-known context around upcoming meeting attendees so the
// frontend can render compact preparation cards.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

const MAX_MEETINGS = 20;
const LARGE_MEETING_ATTENDEE_THRESHOLD = 50;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface MeetingRow {
  id: string;
  title: string;
  start_time: string;
  location: string | null;
  attendees: string[] | null;
}

interface CompanyRow {
  id: string;
  name: string;
}

interface PersonRow {
  id: string;
  name: string;
  email: string | null;
  aliases: string[] | null;
  company_id: string | null;
  companies: CompanyRow | CompanyRow[] | null;
}

interface CommitmentRow {
  id: string;
  title: string;
  do_by: string | null;
  status: string;
  created_at?: string | null;
}

interface MemoryRow {
  id: string;
  content: string;
  created_at: string;
}

interface IdeaRow {
  id: string;
  title: string;
  created_at: string;
}

interface CompanyIdeaRow {
  id: string;
  title: string;
  created_at: string;
}

interface CompanyCommitmentRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

interface PriorMeetingRow {
  id: string;
  title: string;
  start_time: string;
}

interface PreBriefAttendee {
  raw: string;
  person_id: string | null;
  name: string;
  company_id: string | null;
  company_name: string | null;
  open_commitments: Array<{ id: string; title: string; do_by: string | null; status: string }>;
  recent_memories: MemoryRow[];
  recent_ideas: IdeaRow[];
  prior_meetings: PriorMeetingRow[];
}

interface PreBrief {
  meeting: {
    id: string;
    title: string;
    start_time: string;
    location: string | null;
    attendees_raw: string[];
    attendee_count: number;
  };
  context_status: "ready" | "skipped_large_meeting";
  context_note: string | null;
  attendees: PreBriefAttendee[];
  primary_company: {
    id: string;
    name: string;
    open_company_ideas: Array<{ id: string; title: string }>;
    open_company_commitments: Array<{ id: string; title: string; status: string }>;
  } | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function displayNameFromRaw(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "Unknown attendee";
  if (!isEmail(trimmed)) return trimmed;
  return trimmed.split("@")[0].replace(/[._-]+/g, " ");
}

function companyFromPerson(person: PersonRow): CompanyRow | null {
  if (Array.isArray(person.companies)) return person.companies[0] ?? null;
  return person.companies ?? null;
}

function resolveAttendee(raw: string, people: PersonRow[]): PersonRow | null {
  const key = normalize(raw);
  if (!key) return null;

  const emailMatch = people.find((p) => normalize(p.email) === key);
  if (emailMatch) return emailMatch;

  if (isEmail(raw)) {
    const aliasMatch = people.find((p) =>
      (p.aliases ?? []).some((alias) => normalize(alias) === key)
    );
    if (aliasMatch) return aliasMatch;
  }

  return people.find((p) => normalize(p.name) === key) ?? null;
}

function dedupeCommitments(rows: CommitmentRow[]): CommitmentRow[] {
  const seen = new Set<string>();
  const deduped: CommitmentRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    deduped.push(row);
  }
  return deduped
    .sort((a, b) => {
      if (a.do_by && b.do_by) return a.do_by.localeCompare(b.do_by);
      if (a.do_by) return -1;
      if (b.do_by) return 1;
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    })
    .slice(0, 5);
}

function dedupeCompanyIdeas(rows: CompanyIdeaRow[]): Array<{ id: string; title: string }> {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5)
    .map((row) => ({ id: row.id, title: row.title }));
}

function dedupeCompanyCommitments(
  rows: CompanyCommitmentRow[]
): Array<{ id: string; title: string; status: string }> {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5)
    .map((row) => ({ id: row.id, title: row.title, status: row.status }));
}

async function resolveUserId(req: Request, adminClient: ReturnType<typeof createClient>, serviceRoleKey: string) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { response: jsonResponse({ error: "Missing authorization" }, 401) };
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token === serviceRoleKey) {
    const defaultUserId = Deno.env.get("RESURFACE_DEFAULT_USER_ID");
    if (!defaultUserId) {
      return { response: jsonResponse({ error: "RESURFACE_DEFAULT_USER_ID not set" }, 500) };
    }
    return { userId: defaultUserId };
  }

  const { data: { user } } = await adminClient.auth.getUser(token);
  if (!user) {
    return { response: jsonResponse({ error: "Unauthorized" }, 401) };
  }
  return { userId: user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SB_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const auth = await resolveUserId(req, admin, serviceRoleKey);
    if (auth.response) return auth.response;

    const userId = auth.userId;
    if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);
    const now = new Date();
    const weekOut = new Date(now.getTime() + 7 * MS_PER_DAY);

    const [meetingsRes, peopleRes] = await Promise.all([
      admin
        .from("meetings")
        .select("id, title, start_time, location, attendees")
        .eq("user_id", userId)
        .gte("start_time", now.toISOString())
        .lte("start_time", weekOut.toISOString())
        .order("start_time", { ascending: true })
        .limit(MAX_MEETINGS),
      admin
        .from("people")
        .select("id, name, email, aliases, company_id, companies(id, name)")
        .eq("user_id", userId)
        .order("name"),
    ]);

    if (meetingsRes.error) throw meetingsRes.error;
    if (peopleRes.error) throw peopleRes.error;

    const meetings = (meetingsRes.data ?? []) as MeetingRow[];
    const people = (peopleRes.data ?? []) as PersonRow[];
    const briefs: PreBrief[] = [];

    for (const meeting of meetings) {
      const rawAttendees = (meeting.attendees ?? []).filter((a) => a.trim().length > 0);
      if (rawAttendees.length >= LARGE_MEETING_ATTENDEE_THRESHOLD) {
        briefs.push({
          meeting: {
            id: meeting.id,
            title: meeting.title,
            start_time: meeting.start_time,
            location: meeting.location,
            attendees_raw: [],
            attendee_count: rawAttendees.length,
          },
          context_status: "skipped_large_meeting",
          context_note: `Large meeting with ${rawAttendees.length} attendees; attendee context skipped.`,
          attendees: [],
          primary_company: null,
        });
        continue;
      }

      const attendeeContexts = await Promise.all(
        rawAttendees.map(async (raw): Promise<PreBriefAttendee> => {
          const person = resolveAttendee(raw, people);
          const company = person ? companyFromPerson(person) : null;
          if (!person) {
            return {
              raw,
              person_id: null,
              name: displayNameFromRaw(raw),
              company_id: null,
              company_name: null,
              open_commitments: [],
              recent_memories: [],
              recent_ideas: [],
              prior_meetings: [],
            };
          }

          const sixtyDaysAgo = new Date(
            new Date(meeting.start_time).getTime() - 60 * MS_PER_DAY
          ).toISOString();

          const commitmentQueries = [
            admin
              .from("commitments")
              .select("id, title, do_by, status, created_at")
              .eq("user_id", userId)
              .eq("person_id", person.id)
              .in("status", ["open", "waiting"])
              .limit(5),
            admin
              .from("commitments")
              .select("id, title, do_by, status, created_at")
              .eq("user_id", userId)
              .ilike("counterpart", `%${person.name}%`)
              .in("status", ["open", "waiting"])
              .limit(5),
          ];

          const [byPersonRes, byNameRes, memoriesRes, ideasRes, priorMeetingsRes] =
            await Promise.all([
              ...commitmentQueries,
              admin
                .from("memories")
                .select("id, content, created_at")
                .eq("user_id", userId)
                .ilike("content", `%${person.name}%`)
                .order("created_at", { ascending: false })
                .limit(3),
              admin
                .from("ideas")
                .select("id, title, created_at")
                .eq("user_id", userId)
                .ilike("originated_by", person.name)
                .not("status", "in", '("dismissed","archived")')
                .order("created_at", { ascending: false })
                .limit(3),
              admin
                .from("meeting_attendees")
                .select("meeting_id, meetings(id, title, start_time)")
                .eq("person_id", person.id)
                .neq("meeting_id", meeting.id)
                .limit(20),
            ]);

          if (byPersonRes.error) throw byPersonRes.error;
          if (byNameRes.error) throw byNameRes.error;
          if (memoriesRes.error) throw memoriesRes.error;
          if (ideasRes.error) throw ideasRes.error;
          if (priorMeetingsRes.error) throw priorMeetingsRes.error;

          const priorMeetings = ((priorMeetingsRes.data ?? []) as unknown[])
            .map((row) => {
              const meetingRow = (row as { meetings?: PriorMeetingRow | PriorMeetingRow[] | null }).meetings;
              const m = Array.isArray(meetingRow) ? meetingRow[0] : meetingRow;
              return m ?? null;
            })
            .filter((m): m is PriorMeetingRow =>
              Boolean(m?.start_time && m.start_time < meeting.start_time && m.start_time >= sixtyDaysAgo)
            )
            .sort((a, b) => b.start_time.localeCompare(a.start_time))
            .slice(0, 5);

          const openCommitments = dedupeCommitments([
            ...((byPersonRes.data ?? []) as CommitmentRow[]),
            ...((byNameRes.data ?? []) as CommitmentRow[]),
          ]).map((c) => ({
            id: c.id,
            title: c.title,
            do_by: c.do_by,
            status: c.status,
          }));

          return {
            raw,
            person_id: person.id,
            name: person.name,
            company_id: person.company_id,
            company_name: company?.name ?? null,
            open_commitments: openCommitments,
            recent_memories: (memoriesRes.data ?? []) as MemoryRow[],
            recent_ideas: (ideasRes.data ?? []) as IdeaRow[],
            prior_meetings: priorMeetings,
          };
        })
      );

      const companyCounts = new Map<string, { company: CompanyRow; count: number }>();
      for (const attendee of attendeeContexts) {
        if (!attendee.company_id || !attendee.company_name) continue;
        const current = companyCounts.get(attendee.company_id);
        companyCounts.set(attendee.company_id, {
          company: { id: attendee.company_id, name: attendee.company_name },
          count: (current?.count ?? 0) + 1,
        });
      }

      const primaryCompanyEntry = [...companyCounts.values()]
        .sort((a, b) => b.count - a.count)[0];
      let primaryCompany: PreBrief["primary_company"] = null;

      if (primaryCompanyEntry) {
        const company = primaryCompanyEntry.company;
        const [ideasByIdRes, ideasByNameRes, commitmentsByIdRes, commitmentsByNameRes] =
          await Promise.all([
            admin
              .from("ideas")
              .select("id, title, created_at")
              .eq("user_id", userId)
              .eq("company_id", company.id)
              .not("status", "in", '("dismissed","archived")')
              .order("created_at", { ascending: false })
              .limit(5),
            admin
              .from("ideas")
              .select("id, title, created_at")
              .eq("user_id", userId)
              .ilike("company_name", `%${company.name}%`)
              .not("status", "in", '("dismissed","archived")')
              .order("created_at", { ascending: false })
              .limit(5),
            admin
              .from("commitments")
              .select("id, title, status, created_at")
              .eq("user_id", userId)
              .eq("company_id", company.id)
              .in("status", ["open", "waiting"])
              .order("created_at", { ascending: false })
              .limit(5),
            admin
              .from("commitments")
              .select("id, title, status, created_at")
              .eq("user_id", userId)
              .ilike("company", `%${company.name}%`)
              .in("status", ["open", "waiting"])
              .order("created_at", { ascending: false })
              .limit(5),
          ]);
        if (ideasByIdRes.error) throw ideasByIdRes.error;
        if (ideasByNameRes.error) throw ideasByNameRes.error;
        if (commitmentsByIdRes.error) throw commitmentsByIdRes.error;
        if (commitmentsByNameRes.error) throw commitmentsByNameRes.error;

        const companyIdeas = dedupeCompanyIdeas([
          ...((ideasByIdRes.data ?? []) as CompanyIdeaRow[]),
          ...((ideasByNameRes.data ?? []) as CompanyIdeaRow[]),
        ]);
        const companyCommitments = dedupeCompanyCommitments([
          ...((commitmentsByIdRes.data ?? []) as CompanyCommitmentRow[]),
          ...((commitmentsByNameRes.data ?? []) as CompanyCommitmentRow[]),
        ]);

        primaryCompany = {
          id: company.id,
          name: company.name,
          open_company_ideas: companyIdeas,
          open_company_commitments: companyCommitments,
        };
      }

      briefs.push({
        meeting: {
          id: meeting.id,
          title: meeting.title,
          start_time: meeting.start_time,
          location: meeting.location,
          attendees_raw: rawAttendees,
          attendee_count: rawAttendees.length,
        },
        context_status: "ready",
        context_note: null,
        attendees: attendeeContexts,
        primary_company: primaryCompany,
      });
    }

    return jsonResponse(briefs);
  } catch (error) {
    console.error("[get-prebriefs]", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});
