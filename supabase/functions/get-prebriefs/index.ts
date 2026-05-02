// get-prebriefs — meeting-shaped context for the next 7 days.
//
// Designed from the user's POV: walking into a meeting, what specifically
// would change how I prepare? Not "what records can we join to" — what
// knowledge actually matters.
//
// Two render branches based on meeting type:
//   - one_off        → ideas / memories / commitments on the topic
//                      (semantic match) + up to 2 dedup'd similar prior
//                      meetings. The "what I've thought / heard / promised"
//                      view.
//   - recurring      → open commitments / ideas / tasks from the last 2-3
//                      prior instances of this same series. The "where
//                      did we leave off" view. No topic-context — you do
//                      this meeting weekly, you don't need a topic
//                      refresher every time.
//
// Universal:
//   - Drop the user's own attendee block (you know who you are).
//   - Drop unresolved attendees with zero signal (name-only with no
//     commitments/memories/prior meetings → just count them).
//   - Drop the primary_company rollup; if a company is relevant, it's
//     already surfacing through topic items tagged to it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

const MAX_MEETINGS = 20;
const LARGE_MEETING_ATTENDEE_THRESHOLD = 50;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Topic-context thresholds.
const TOPIC_MIN_SIMILARITY = 0.55;
const SIMILAR_MEETING_MIN_SIMILARITY = 0.7;
const MAX_TOPIC_IDEAS = 5;
const MAX_TOPIC_MEMORIES = 3;
const MAX_TOPIC_COMMITMENTS = 5;
const MAX_SIMILAR_MEETINGS = 2;

// Recurring detection. A meeting is "recurring" if there are 2+ prior
// instances with the same exact title in the last 60 days.
const RECURRING_LOOKBACK_DAYS = 60;
const RECURRING_MIN_PRIOR_INSTANCES = 2;
// For a recurring meeting, look at the 3 most recent prior instances
// to find still-open items.
const RECURRING_INSTANCES_TO_SCAN = 3;
const MAX_SERIES_OPEN_ITEMS = 8;

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

interface TopicItem {
  id: string;
  title: string;
  snippet: string;
  similarity: number;
  created_at: string;
}

interface TopicCommitment extends TopicItem {
  status: string;
  do_by: string | null;
}

interface TopicMeeting {
  id: string;
  title: string;
  start_time: string;
  similarity: number;
}

interface SeriesOpenItem {
  source_type: "commitment" | "idea" | "task";
  id: string;
  title: string;
  status: string;
  do_by: string | null;
  source_meeting_id: string;
  source_meeting_title: string;
  source_meeting_date: string;
}

interface PreBriefAttendee {
  raw: string;
  person_id: string;
  name: string;
  company_id: string | null;
  company_name: string | null;
  open_commitments: Array<{ id: string; title: string; do_by: string | null; status: string }>;
  recent_memories: MemoryRow[];
  prior_meeting_count: number;
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
  meeting_kind: "one_off" | "recurring" | "large_meeting";
  context_status: "ready" | "no_embedding";
  context_note: string | null;

  // one_off branch
  topic_ideas?: TopicItem[];
  topic_memories?: TopicItem[];
  topic_commitments?: TopicCommitment[];
  similar_meetings?: TopicMeeting[];

  // recurring branch
  series_open_items?: SeriesOpenItem[];
  series_prior_instance_count?: number;

  // both
  attendee_context: PreBriefAttendee[];
  unresolved_attendee_count: number;
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

// Returns true if this attendee is the user themselves. The pre-brief
// shouldn't echo the user's own bio at them.
function isSelfAttendee(raw: string, userEmail: string | null, userDisplayName: string | null): boolean {
  if (!userEmail && !userDisplayName) return false;
  const key = normalize(raw);
  if (userEmail && key === normalize(userEmail)) return true;
  if (userDisplayName && key === normalize(userDisplayName)) return true;
  // Email local-part match — covers cases where the calendar lists "Dustin
  // Collis <dustin@example>" or just the email's display.
  if (userEmail && key.includes("@")) {
    const userLocal = userEmail.split("@")[0].toLowerCase();
    const rawLocal = key.split("@")[0];
    if (rawLocal === userLocal) return true;
  }
  return false;
}

async function fetchTopicContext(
  admin: ReturnType<typeof createClient>,
  userId: string,
  meetingId: string,
  thisMeetingTitle: string,
): Promise<{
  ideas: TopicItem[];
  memories: TopicItem[];
  commitments: TopicCommitment[];
  similarMeetings: TopicMeeting[];
  hadEmbedding: boolean;
}> {
  // find_similar returns up to N nearest neighbors across all four corpus
  // tables. We pull a generous batch (20) and split by source_table on
  // our side so each bucket can have its own cap and threshold rather
  // than competing for slots in a single result list. That solves the
  // bug where recurring meetings flooded all 8 topic_context slots.
  try {
    const { data, error } = await admin.rpc("find_similar", {
      source_table: "meetings",
      source_id: meetingId,
      searching_user_id: userId,
      max_results: 20,
    });
    if (error || !data) return empty();
    const rows = data as Array<{
      result_table: string;
      result_id: string;
      title: string;
      snippet: string;
      created_at: string;
      similarity: number;
    }>;
    if (rows.length === 0) {
      // Either the meeting has no embedding yet (insert trigger raced)
      // or there's literally nothing semantically nearby. Caller can
      // distinguish via hadEmbedding.
      return { ...empty(), hadEmbedding: false };
    }

    const ideas: TopicItem[] = [];
    const memories: TopicItem[] = [];
    const commitments: TopicCommitment[] = [];
    const similarMeetings: TopicMeeting[] = [];
    const seenMeetingTitles = new Set<string>([thisMeetingTitle.trim().toLowerCase()]);

    // We need extra columns for memories (content) and commitments
    // (status, do_by) that find_similar doesn't return. Collect ids and
    // hydrate in two follow-up queries.
    const memoryIds: string[] = [];
    const commitmentIds: string[] = [];

    for (const row of rows) {
      if (row.similarity < TOPIC_MIN_SIMILARITY) continue;

      if (row.result_table === "ideas" && ideas.length < MAX_TOPIC_IDEAS) {
        ideas.push({
          id: row.result_id,
          title: row.title ?? "",
          snippet: row.snippet ?? "",
          similarity: row.similarity,
          created_at: row.created_at,
        });
      } else if (row.result_table === "memories" && memories.length < MAX_TOPIC_MEMORIES) {
        memories.push({
          id: row.result_id,
          title: row.title ?? "",
          snippet: row.snippet ?? "",
          similarity: row.similarity,
          created_at: row.created_at,
        });
        memoryIds.push(row.result_id);
      } else if (row.result_table === "commitments" && commitments.length < MAX_TOPIC_COMMITMENTS) {
        commitments.push({
          id: row.result_id,
          title: row.title ?? "",
          snippet: row.snippet ?? "",
          similarity: row.similarity,
          created_at: row.created_at,
          status: "open", // hydrated below
          do_by: null,
        });
        commitmentIds.push(row.result_id);
      } else if (
        row.result_table === "meetings" &&
        similarMeetings.length < MAX_SIMILAR_MEETINGS &&
        row.similarity >= SIMILAR_MEETING_MIN_SIMILARITY
      ) {
        // Dedupe by lowercased title — collapses recurring series and
        // exact-title repeats so each "similar prior meeting" represents
        // a distinct topic, not a stack of the same recurring slot.
        const titleKey = (row.title ?? "").trim().toLowerCase();
        if (titleKey && !seenMeetingTitles.has(titleKey)) {
          seenMeetingTitles.add(titleKey);
          similarMeetings.push({
            id: row.result_id,
            title: row.title ?? "",
            start_time: row.created_at,
            similarity: row.similarity,
          });
        }
      }
    }

    // Hydrate commitment status / do_by, and filter to open ones only
    // (a closed commitment is interesting context but not "what's still
    // outstanding on this topic").
    if (commitmentIds.length > 0) {
      const { data: commitmentRows } = await admin
        .from("commitments")
        .select("id, status, do_by")
        .in("id", commitmentIds);
      const byId = new Map<string, { status: string; do_by: string | null }>();
      for (const row of (commitmentRows ?? []) as Array<{ id: string; status: string; do_by: string | null }>) {
        byId.set(row.id, { status: row.status, do_by: row.do_by });
      }
      for (const c of commitments) {
        const meta = byId.get(c.id);
        if (meta) {
          c.status = meta.status;
          c.do_by = meta.do_by;
        }
      }
    }
    // Drop already-met / cancelled / broken commitments — they're not
    // open topic threads anymore.
    const openCommitments = commitments.filter((c) =>
      c.status === "open" || c.status === "waiting"
    );

    return {
      ideas,
      memories,
      commitments: openCommitments,
      similarMeetings,
      hadEmbedding: true,
    };
  } catch (err) {
    console.warn("[get-prebriefs] topic_context fetch failed:", err);
    return empty();
  }
}

function empty() {
  return {
    ideas: [] as TopicItem[],
    memories: [] as TopicItem[],
    commitments: [] as TopicCommitment[],
    similarMeetings: [] as TopicMeeting[],
    hadEmbedding: true,
  };
}

async function detectRecurring(
  admin: ReturnType<typeof createClient>,
  userId: string,
  meeting: MeetingRow,
): Promise<{ priorInstances: MeetingRow[]; isRecurring: boolean }> {
  // Title-match within a 60-day lookback window. We don't have a
  // schema-level series identifier, but exact title matches are a good
  // proxy: Outlook recurring meetings keep the same title across
  // instances, and our calendar-sync stores them as separate rows.
  const lookbackIso = new Date(
    new Date(meeting.start_time).getTime() - RECURRING_LOOKBACK_DAYS * MS_PER_DAY,
  ).toISOString();

  const { data, error } = await admin
    .from("meetings")
    .select("id, title, start_time, location, attendees")
    .eq("user_id", userId)
    .eq("title", meeting.title)
    .neq("id", meeting.id)
    .lt("start_time", meeting.start_time)
    .gte("start_time", lookbackIso)
    .order("start_time", { ascending: false })
    .limit(RECURRING_INSTANCES_TO_SCAN);

  if (error) {
    console.warn("[get-prebriefs] recurring detection failed:", error);
    return { priorInstances: [], isRecurring: false };
  }

  const priorInstances = (data ?? []) as MeetingRow[];
  return {
    priorInstances,
    isRecurring: priorInstances.length >= RECURRING_MIN_PRIOR_INSTANCES,
  };
}

async function fetchSeriesOpenItems(
  admin: ReturnType<typeof createClient>,
  userId: string,
  priorInstances: MeetingRow[],
): Promise<SeriesOpenItem[]> {
  if (priorInstances.length === 0) return [];
  const meetingIds = priorInstances.map((m) => m.id);
  const meetingTitleByDate = new Map<
    string,
    { title: string; date: string }
  >();
  for (const m of priorInstances) {
    meetingTitleByDate.set(m.id, {
      title: m.title,
      date: m.start_time.substring(0, 10),
    });
  }

  // Pull open commitments, open items, and surfaced ideas from the prior
  // instances. All three queries scope by source_meeting_id and a status
  // that means "still hanging." Concatenate, sort by source meeting
  // recency, cap.
  const [commitmentsRes, ideasRes, itemsRes] = await Promise.all([
    admin
      .from("commitments")
      .select("id, title, status, do_by, source_meeting_id, created_at")
      .eq("user_id", userId)
      .in("source_meeting_id", meetingIds)
      .in("status", ["open", "waiting"]),
    admin
      .from("ideas")
      .select("id, title, status, source_meeting_id, created_at")
      .eq("user_id", userId)
      .in("source_meeting_id", meetingIds)
      .not("status", "in", '("dismissed","archived")'),
    admin
      .from("items")
      .select("id, title, status, source_meeting_id, due_date, created_at")
      .eq("user_id", userId)
      .in("source_meeting_id", meetingIds)
      .in("status", ["open", "in_progress", "waiting"]),
  ]);

  if (commitmentsRes.error || ideasRes.error || itemsRes.error) {
    console.warn(
      "[get-prebriefs] series open items fetch failed:",
      commitmentsRes.error || ideasRes.error || itemsRes.error,
    );
    return [];
  }

  const collected: SeriesOpenItem[] = [];

  for (const row of (commitmentsRes.data ?? []) as Array<{
    id: string;
    title: string;
    status: string;
    do_by: string | null;
    source_meeting_id: string;
    created_at: string;
  }>) {
    const meta = meetingTitleByDate.get(row.source_meeting_id);
    if (!meta) continue;
    collected.push({
      source_type: "commitment",
      id: row.id,
      title: row.title,
      status: row.status,
      do_by: row.do_by,
      source_meeting_id: row.source_meeting_id,
      source_meeting_title: meta.title,
      source_meeting_date: meta.date,
    });
  }

  for (const row of (ideasRes.data ?? []) as Array<{
    id: string;
    title: string;
    status: string;
    source_meeting_id: string;
    created_at: string;
  }>) {
    const meta = meetingTitleByDate.get(row.source_meeting_id);
    if (!meta) continue;
    collected.push({
      source_type: "idea",
      id: row.id,
      title: row.title,
      status: row.status,
      do_by: null,
      source_meeting_id: row.source_meeting_id,
      source_meeting_title: meta.title,
      source_meeting_date: meta.date,
    });
  }

  for (const row of (itemsRes.data ?? []) as Array<{
    id: string;
    title: string;
    status: string;
    source_meeting_id: string;
    due_date: string | null;
    created_at: string;
  }>) {
    const meta = meetingTitleByDate.get(row.source_meeting_id);
    if (!meta) continue;
    collected.push({
      source_type: "task",
      id: row.id,
      title: row.title,
      status: row.status,
      do_by: row.due_date,
      source_meeting_id: row.source_meeting_id,
      source_meeting_title: meta.title,
      source_meeting_date: meta.date,
    });
  }

  // Sort: most recent source meeting first, then commitments before ideas
  // before tasks. Cap.
  collected.sort((a, b) => {
    const dateCmp = b.source_meeting_date.localeCompare(a.source_meeting_date);
    if (dateCmp !== 0) return dateCmp;
    const order = { commitment: 0, idea: 1, task: 2 } as const;
    return order[a.source_type] - order[b.source_type];
  });

  return collected.slice(0, MAX_SERIES_OPEN_ITEMS);
}

async function buildAttendeeContext(
  admin: ReturnType<typeof createClient>,
  userId: string,
  meeting: MeetingRow,
  rawAttendees: string[],
  people: PersonRow[],
  userEmail: string | null,
  userDisplayName: string | null,
): Promise<{ attendees: PreBriefAttendee[]; unresolvedCount: number }> {
  let unresolvedCount = 0;
  const resolvedAttendees: Array<{ raw: string; person: PersonRow }> = [];

  for (const raw of rawAttendees) {
    if (isSelfAttendee(raw, userEmail, userDisplayName)) continue;
    const person = resolveAttendee(raw, people);
    if (!person) {
      unresolvedCount += 1;
      continue;
    }
    resolvedAttendees.push({ raw, person });
  }

  if (resolvedAttendees.length === 0) {
    return { attendees: [], unresolvedCount };
  }

  const sixtyDaysAgo = new Date(
    new Date(meeting.start_time).getTime() - 60 * MS_PER_DAY,
  ).toISOString();

  const contexts = await Promise.all(
    resolvedAttendees.map(async ({ raw, person }): Promise<PreBriefAttendee | null> => {
      const company = companyFromPerson(person);
      const [byPersonRes, byNameRes, memoriesRes, priorMeetingsRes] = await Promise.all([
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
        admin
          .from("memories")
          .select("id, content, created_at")
          .eq("user_id", userId)
          .ilike("content", `%${person.name}%`)
          .gte("created_at", sixtyDaysAgo)
          .order("created_at", { ascending: false })
          .limit(2),
        admin
          .from("meeting_attendees")
          .select("meeting_id, meetings(start_time)")
          .eq("person_id", person.id)
          .neq("meeting_id", meeting.id)
          .limit(20),
      ]);

      if (byPersonRes.error || byNameRes.error || memoriesRes.error || priorMeetingsRes.error) {
        console.warn("[get-prebriefs] attendee context fetch failed:", person.name);
        return null;
      }

      const openCommitments = dedupeCommitments([
        ...((byPersonRes.data ?? []) as CommitmentRow[]),
        ...((byNameRes.data ?? []) as CommitmentRow[]),
      ]).map((c) => ({
        id: c.id,
        title: c.title,
        do_by: c.do_by,
        status: c.status,
      }));

      const priorMeetingCount = ((priorMeetingsRes.data ?? []) as unknown[])
        .map((row) => {
          const meetingRow = (row as { meetings?: { start_time?: string } | { start_time?: string }[] | null }).meetings;
          const m = Array.isArray(meetingRow) ? meetingRow[0] : meetingRow;
          return m?.start_time ?? null;
        })
        .filter((t): t is string =>
          Boolean(t && t < meeting.start_time && t >= sixtyDaysAgo),
        ).length;

      const recentMemories = (memoriesRes.data ?? []) as MemoryRow[];

      // Drop attendees with zero signal — name only, no commitments,
      // no memories, no prior meetings. They contribute nothing useful;
      // surfacing them is just visual noise.
      if (openCommitments.length === 0 && recentMemories.length === 0 && priorMeetingCount === 0) {
        return null;
      }

      return {
        raw,
        person_id: person.id,
        name: person.name,
        company_id: person.company_id,
        company_name: company?.name ?? null,
        open_commitments: openCommitments,
        recent_memories: recentMemories,
        prior_meeting_count: priorMeetingCount,
      };
    }),
  );

  return {
    attendees: contexts.filter((a): a is PreBriefAttendee => a !== null),
    unresolvedCount,
  };
}

async function resolveUserId(
  req: Request,
  adminClient: ReturnType<typeof createClient>,
  serviceRoleKey: string,
): Promise<{ userId?: string; response?: Response }> {
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

    // Pull the user's identity for self-detection on the attendee block.
    const [{ data: authUser }, profileRes] = await Promise.all([
      admin.auth.admin.getUserById(userId),
      admin.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    ]);
    const userEmail = authUser?.user?.email ?? null;
    const userDisplayName = (profileRes.data as { display_name?: string } | null)?.display_name ?? null;

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
      const isLargeMeeting = rawAttendees.length >= LARGE_MEETING_ATTENDEE_THRESHOLD;

      // Detect recurring up front. The series-open-items query is more
      // useful than topic context for repeats, so we branch the whole
      // shape based on this.
      const recurringInfo = isLargeMeeting
        ? { priorInstances: [], isRecurring: false }
        : await detectRecurring(admin, userId, meeting);

      let topicResult: Awaited<ReturnType<typeof fetchTopicContext>> | null = null;
      let seriesOpenItems: SeriesOpenItem[] = [];

      if (recurringInfo.isRecurring) {
        seriesOpenItems = await fetchSeriesOpenItems(admin, userId, recurringInfo.priorInstances);
      } else {
        topicResult = await fetchTopicContext(admin, userId, meeting.id, meeting.title);
      }

      const { attendees: attendeeContext, unresolvedCount } = isLargeMeeting
        ? { attendees: [], unresolvedCount: rawAttendees.length }
        : await buildAttendeeContext(
            admin,
            userId,
            meeting,
            rawAttendees,
            people,
            userEmail,
            userDisplayName,
          );

      let kind: PreBrief["meeting_kind"];
      if (isLargeMeeting) kind = "large_meeting";
      else if (recurringInfo.isRecurring) kind = "recurring";
      else kind = "one_off";

      const contextStatus: PreBrief["context_status"] =
        topicResult && !topicResult.hadEmbedding ? "no_embedding" : "ready";

      let contextNote: string | null = null;
      if (isLargeMeeting) {
        contextNote = `Large meeting with ${rawAttendees.length} attendees; per-attendee context skipped.`;
      } else if (contextStatus === "no_embedding") {
        contextNote = "This meeting hasn't been embedded yet — topic context will appear once embeddings are backfilled.";
      }

      briefs.push({
        meeting: {
          id: meeting.id,
          title: meeting.title,
          start_time: meeting.start_time,
          location: meeting.location,
          attendees_raw: isLargeMeeting ? [] : rawAttendees,
          attendee_count: rawAttendees.length,
        },
        meeting_kind: kind,
        context_status: contextStatus,
        context_note: contextNote,
        topic_ideas: topicResult?.ideas,
        topic_memories: topicResult?.memories,
        topic_commitments: topicResult?.commitments,
        similar_meetings: topicResult?.similarMeetings,
        series_open_items: recurringInfo.isRecurring ? seriesOpenItems : undefined,
        series_prior_instance_count: recurringInfo.isRecurring
          ? recurringInfo.priorInstances.length
          : undefined,
        attendee_context: attendeeContext,
        unresolved_attendee_count: unresolvedCount,
      });
    }

    return jsonResponse(briefs);
  } catch (error) {
    console.error("[get-prebriefs]", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
