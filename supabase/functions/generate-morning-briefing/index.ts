// Morning briefing generator.
//
// Produces (or returns the existing) snapshot for today: today's meetings
// with per-meeting context, pending follow-ups, pressing commitments, and
// today's task list. The AI generates only the 60-second intro paragraph;
// everything else is pulled deterministically and saved as jsonb so the
// frontend renders without further synthesis.
//
// Snapshot semantics: one row per (user_id, briefing_date). First call of
// the day generates and persists; subsequent calls return the same data.
// Pass { force: true } to regenerate.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import { recordAiCall } from "../_shared/telemetry.ts";

const MODEL = "claude-sonnet-4-6";

interface AttendeeContext {
  name: string;
  person_id: string | null;
  company: string | null;
  last_seen_meeting_date: string | null;
  open_commitments: Array<{
    id: string;
    title: string;
    direction: string;
    do_by: string | null;
  }>;
}

interface MeetingItem {
  id: string;
  title: string | null;
  start_time: string | null;
  end_time: string | null;
  attendees: string[];
  attendee_context: AttendeeContext[];
  pursuit: { id: string; name: string; color: string | null } | null;
  prior_summary: string | null;
}

interface FollowUpItem {
  id: string;
  source_meeting_id: string;
  source_meeting_title: string | null;
  draft_subject: string;
  recipients: string[];
  age_days: number;
}

interface CommitmentItem {
  id: string;
  title: string;
  counterpart: string | null;
  company: string | null;
  do_by: string | null;
  days_overdue: number;
}

interface TaskItem {
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  stakes: number | null;
  staleness_score: number | null;
  pinned: boolean;
  surface_reason: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
    } = await adminClient.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    // ---- Determine "today" in user's timezone ----
    const { data: profile } = await adminClient
      .from("profiles")
      .select("timezone, display_name, bio")
      .eq("id", userId)
      .single();
    const tz: string =
      (profile?.timezone as string | undefined) || "America/New_York";
    const userDisplayName: string =
      (profile?.display_name as string | undefined) || user.email?.split("@")[0] || "the user";
    const userBio: string =
      (profile?.bio as string | undefined) || "";

    const briefingDate = ymdInTz(new Date(), tz);
    const dayOfWeek = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: tz,
    }).format(new Date());

    // ---- Snapshot: return existing if force=false ----
    if (!force) {
      const { data: existing } = await adminClient
        .from("morning_briefings")
        .select("*")
        .eq("user_id", userId)
        .eq("briefing_date", briefingDate)
        .maybeSingle();
      if (existing && existing.status === "ready") {
        return jsonResponse(existing);
      }
    } else {
      // Force-regenerate: blow away today's row so we don't trip the unique constraint.
      await adminClient
        .from("morning_briefings")
        .delete()
        .eq("user_id", userId)
        .eq("briefing_date", briefingDate);
    }

    // Insert a stub row in 'generating' state so the frontend can poll if it wants.
    const { data: stub, error: stubErr } = await adminClient
      .from("morning_briefings")
      .insert({
        user_id: userId,
        briefing_date: briefingDate,
        status: "generating",
      })
      .select()
      .single();
    if (stubErr) throw stubErr;
    const briefingId = stub.id;

    try {
      // ---- Pull data ----
      const dayStart = startOfDayInTzAsUtc(briefingDate, tz);
      const dayEnd = endOfDayInTzAsUtc(briefingDate, tz);

      const meetings = await fetchTodaysMeetings(adminClient, userId, dayStart, dayEnd);
      const followUps = await fetchPendingFollowUps(adminClient, userId);
      const commitments = await fetchPressingCommitments(adminClient, userId, dayEnd);
      const tasks = await fetchTodaysTasks(adminClient, userId, briefingDate);

      // Hydrate per-meeting context (attendees, prior interactions, open commitments).
      const meetingsWithContext = await hydrateMeetings(
        adminClient,
        userId,
        meetings
      );

      // ---- AI synthesis: short intro paragraph ----
      const promptStart = Date.now();
      const aiResult = await synthesizeIntro({
        anthropicKey,
        userDisplayName,
        userBio,
        dayOfWeek,
        briefingDate,
        meetings: meetingsWithContext,
        followUps,
        commitments,
        tasks,
      });
      const latency = Date.now() - promptStart;

      const introText: string = aiResult.intro || fallbackIntro(meetingsWithContext, followUps, commitments, tasks);

      // ---- Persist + telemetry ----
      const { data: ready, error: updateErr } = await adminClient
        .from("morning_briefings")
        .update({
          intro_text: introText,
          meetings_data: meetingsWithContext,
          follow_ups_data: followUps,
          commitments_data: commitments,
          tasks_data: tasks,
          status: "ready",
          ai_model: MODEL,
          ai_input_tokens: aiResult.usage?.input_tokens ?? 0,
          ai_output_tokens: aiResult.usage?.output_tokens ?? 0,
          ai_cache_read_tokens: aiResult.usage?.cache_read_input_tokens ?? 0,
          ai_latency_ms: latency,
        })
        .eq("id", briefingId)
        .select()
        .single();
      if (updateErr) throw updateErr;

      try {
        await recordAiCall(adminClient, {
          user_id: userId,
          function_name: "generate-morning-briefing",
          model: MODEL,
          usage: aiResult.usage,
          stop_reason: aiResult.stopReason ?? null,
          latency_ms: latency,
          source_type: "morning_briefing",
          source_id: briefingId,
          metadata: { briefing_date: briefingDate },
        });
      } catch (telErr) {
        console.error("[telemetry] failed:", telErr);
      }

      return jsonResponse(ready);
    } catch (genErr) {
      // Mark the row failed so the frontend can show a recovery state.
      await adminClient
        .from("morning_briefings")
        .update({
          status: "failed",
          error_text:
            genErr instanceof Error ? genErr.message : String(genErr),
        })
        .eq("id", briefingId);
      throw genErr;
    }
  } catch (err) {
    console.error("[generate-morning-briefing] error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// ----------------------------------------------------------------------------
// Helpers: timezone math
// ----------------------------------------------------------------------------

function ymdInTz(d: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d); // YYYY-MM-DD
}

// Given YYYY-MM-DD and a timezone, return the UTC ISO instant for that
// date's midnight in that zone. Computed via Intl + a probe: reverse a
// candidate UTC time back through the formatter and adjust until the local
// representation matches the target. One-shot offset calc is good enough.
function startOfDayInTzAsUtc(ymd: string, tz: string): string {
  return localMidnightToUtc(ymd, tz, false);
}

function endOfDayInTzAsUtc(ymd: string, tz: string): string {
  return localMidnightToUtc(ymd, tz, true);
}

function localMidnightToUtc(ymd: string, tz: string, endOfDay: boolean): string {
  // Naive local datetime → assume UTC → adjust for the zone's offset at that wall time.
  const wallTime = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const probe = new Date(`${ymd}T${wallTime}Z`);
  // Find the offset in minutes between UTC and the target zone at this instant.
  const offsetMin = tzOffsetMinutes(probe, tz);
  // Local wall time = UTC + offset. We want UTC = wall - offset.
  const utc = new Date(probe.getTime() - offsetMin * 60_000);
  return utc.toISOString();
}

function tzOffsetMinutes(d: Date, tz: string): number {
  const local = new Date(
    d.toLocaleString("en-US", { timeZone: tz })
  );
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return (local.getTime() - utc.getTime()) / 60_000;
}

// ----------------------------------------------------------------------------
// Helpers: data fetching
// ----------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type Db = any;

async function fetchTodaysMeetings(
  db: Db,
  userId: string,
  dayStartUtc: string,
  dayEndUtc: string
): Promise<MeetingItem[]> {
  const { data } = await db
    .from("meetings")
    .select("id, title, start_time, end_time, attendees")
    .eq("user_id", userId)
    .gte("start_time", dayStartUtc)
    .lte("start_time", dayEndUtc)
    .order("start_time", { ascending: true });
  return (data ?? []).map((m: Record<string, unknown>) => ({
    id: m.id as string,
    title: (m.title as string) ?? null,
    start_time: (m.start_time as string) ?? null,
    end_time: (m.end_time as string) ?? null,
    attendees: ((m.attendees as string[]) ?? []).filter(Boolean),
    attendee_context: [],
    pursuit: null,
    prior_summary: null,
  }));
}

async function fetchPendingFollowUps(
  db: Db,
  userId: string
): Promise<FollowUpItem[]> {
  const { data } = await db
    .from("follow_ups")
    .select(
      "id, source_meeting_id, draft_subject, recipients, created_at"
    )
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (!data || data.length === 0) return [];

  const meetingIds = Array.from(
    new Set(data.map((f: Record<string, unknown>) => f.source_meeting_id as string))
  );
  const { data: meetings } = await db
    .from("meetings")
    .select("id, title")
    .in("id", meetingIds);
  const titleById = new Map<string, string | null>();
  for (const m of meetings ?? []) {
    titleById.set(m.id as string, (m.title as string) ?? null);
  }
  const now = Date.now();
  return data.map((f: Record<string, unknown>) => {
    const created = new Date(f.created_at as string).getTime();
    const ageDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));
    return {
      id: f.id as string,
      source_meeting_id: f.source_meeting_id as string,
      source_meeting_title: titleById.get(f.source_meeting_id as string) ?? null,
      draft_subject: (f.draft_subject as string) ?? "Following up",
      recipients: ((f.recipients as Array<Record<string, unknown>>) ?? []).map(
        (r) => (r.name as string) ?? "(unknown)"
      ),
      age_days: ageDays,
    };
  });
}

async function fetchPressingCommitments(
  db: Db,
  userId: string,
  dayEndUtc: string
): Promise<CommitmentItem[]> {
  // Outgoing only (you owe them), open status, due_by today or earlier.
  const { data } = await db
    .from("commitments")
    .select("id, title, counterpart, company, do_by, status, direction")
    .eq("user_id", userId)
    .eq("direction", "outgoing")
    .eq("status", "open")
    .or(`do_by.lte.${dayEndUtc.split("T")[0]},do_by.is.null`)
    .order("do_by", { ascending: true, nullsFirst: false });
  if (!data) return [];
  const today = new Date(dayEndUtc).getTime();
  return data
    .filter((c: Record<string, unknown>) => {
      const doBy = c.do_by as string | null;
      if (!doBy) return false; // Skip undated commitments for now; they're noise here
      return new Date(doBy).getTime() <= today;
    })
    .map((c: Record<string, unknown>) => {
      const doBy = c.do_by as string;
      const days = Math.floor(
        (today - new Date(doBy).getTime()) / (1000 * 60 * 60 * 24)
      );
      return {
        id: c.id as string,
        title: (c.title as string) ?? "(no title)",
        counterpart: (c.counterpart as string) ?? null,
        company: (c.company as string) ?? null,
        do_by: doBy,
        days_overdue: Math.max(0, days),
      };
    });
}

async function fetchTodaysTasks(
  db: Db,
  userId: string,
  briefingDate: string
): Promise<TaskItem[]> {
  const { data } = await db
    .from("items")
    .select(
      "id, title, due_date, status, stakes, staleness_score, pinned, snoozed_until, tracking"
    )
    .eq("user_id", userId)
    .not("status", "in", '("done","dropped")')
    .eq("tracking", false)
    .or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`)
    .limit(200);
  if (!data) return [];

  const today = briefingDate;
  const out: TaskItem[] = [];
  for (const i of data as Array<Record<string, unknown>>) {
    const dueDate = i.due_date as string | null;
    const stakes = (i.stakes as number | null) ?? null;
    const staleness = (i.staleness_score as number | null) ?? null;
    const pinned = !!i.pinned;
    let reason: string | null = null;
    if (pinned) reason = "pinned";
    else if (dueDate && dueDate < today) reason = "overdue";
    else if (dueDate && dueDate === today) reason = "due today";
    else if (staleness !== null && staleness >= 60) reason = "stale";
    else if (stakes !== null && stakes >= 4) reason = "high stakes";
    if (!reason) continue;
    out.push({
      id: i.id as string,
      title: (i.title as string) ?? "(no title)",
      due_date: dueDate,
      status: (i.status as string) ?? "open",
      stakes,
      staleness_score: staleness,
      pinned,
      surface_reason: reason,
    });
  }
  // Sort: pinned > overdue > due today > stale > high stakes
  const order: Record<string, number> = {
    pinned: 0,
    overdue: 1,
    "due today": 2,
    stale: 3,
    "high stakes": 4,
  };
  out.sort(
    (a, b) =>
      (order[a.surface_reason] ?? 9) - (order[b.surface_reason] ?? 9) ||
      (b.stakes ?? 0) - (a.stakes ?? 0)
  );
  return out.slice(0, 25);
}

// ----------------------------------------------------------------------------
// Per-meeting context hydration
// ----------------------------------------------------------------------------

async function hydrateMeetings(
  db: Db,
  userId: string,
  meetings: MeetingItem[]
): Promise<MeetingItem[]> {
  if (meetings.length === 0) return meetings;

  // Collect all unique attendee names across today's meetings.
  const allAttendeeNames = Array.from(
    new Set(meetings.flatMap((m) => m.attendees))
  );

  // Resolve attendee names → people rows. Match by name (case-insensitive).
  const lowered = allAttendeeNames.map((n) => n.trim().toLowerCase());
  const { data: people } = await db
    .from("people")
    .select("id, name, company_id, companies(name)")
    .eq("user_id", userId);
  const peopleByLowerName = new Map<string, Record<string, unknown>>();
  for (const p of people ?? []) {
    const name = ((p.name as string) ?? "").trim().toLowerCase();
    if (name) peopleByLowerName.set(name, p);
    // Cheap alias: if name has space, also key on first word so "Beth" matches "Beth Smith"
    if (name.includes(" ")) {
      const first = name.split(" ")[0];
      if (first && !peopleByLowerName.has(first)) {
        peopleByLowerName.set(first, p);
      }
    }
  }

  // Pull all open outgoing+incoming commitments referencing these counterparts/companies.
  const { data: commitments } = await db
    .from("commitments")
    .select("id, title, direction, counterpart, company, do_by, status")
    .eq("user_id", userId)
    .eq("status", "open");
  const commitmentsList = (commitments ?? []) as Array<Record<string, unknown>>;

  // For each meeting, build attendee_context.
  const out: MeetingItem[] = [];
  for (const m of meetings) {
    const ctx: AttendeeContext[] = [];
    for (const name of m.attendees) {
      const lower = name.trim().toLowerCase();
      if (
        lower === "speaker -1" ||
        lower.startsWith("speaker ") ||
        lower === "dustin" ||
        lower === "dustin collis"
      ) {
        continue; // Skip placeholders and the user themselves
      }
      const person = peopleByLowerName.get(lower) ?? peopleByLowerName.get(lower.split(" ")[0]);
      const company =
        ((person?.companies as Record<string, unknown> | undefined)?.name as string) ?? null;
      const personId = (person?.id as string) ?? null;

      // Open commitments where counterpart matches this person's name OR
      // company matches their company.
      const open: AttendeeContext["open_commitments"] = [];
      for (const c of commitmentsList) {
        const cp = ((c.counterpart as string) ?? "").trim().toLowerCase();
        const cc = ((c.company as string) ?? "").trim().toLowerCase();
        const matchesPerson = cp && (cp === lower || cp === lower.split(" ")[0]);
        const matchesCompany = cc && company && cc === company.toLowerCase();
        if (matchesPerson || matchesCompany) {
          open.push({
            id: c.id as string,
            title: (c.title as string) ?? "",
            direction: (c.direction as string) ?? "outgoing",
            do_by: (c.do_by as string) ?? null,
          });
        }
      }

      ctx.push({
        name,
        person_id: personId,
        company,
        last_seen_meeting_date: null, // could lookup last meeting_attendees join; deferred for v0 cost
        open_commitments: open,
      });
    }
    out.push({ ...m, attendee_context: ctx });
  }
  return out;
}

// ----------------------------------------------------------------------------
// AI synthesis
// ----------------------------------------------------------------------------

interface SynthesizeArgs {
  anthropicKey: string;
  userDisplayName: string;
  userBio: string;
  dayOfWeek: string;
  briefingDate: string;
  meetings: MeetingItem[];
  followUps: FollowUpItem[];
  commitments: CommitmentItem[];
  tasks: TaskItem[];
}

async function synthesizeIntro(
  args: SynthesizeArgs
): Promise<{
  intro: string | null;
  // deno-lint-ignore no-explicit-any
  usage: any;
  stopReason: string | null;
}> {
  const meetingsBlock = args.meetings
    .map((m) => {
      const time = m.start_time
        ? new Date(m.start_time).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/New_York",
          })
        : "(no time)";
      const attendees = m.attendee_context
        .map((a) => `${a.name}${a.company ? ` (${a.company})` : ""}`)
        .join(", ");
      const openCommits = m.attendee_context
        .flatMap((a) => a.open_commitments)
        .map((c) => `[${c.direction}] ${c.title}`)
        .slice(0, 3)
        .join("; ");
      return `- ${time} ${m.title ?? "(untitled)"} — with ${attendees || "(unclear)"}${openCommits ? ` | open: ${openCommits}` : ""}`;
    })
    .join("\n");

  const followUpsBlock = args.followUps
    .slice(0, 8)
    .map(
      (f) =>
        `- ${f.draft_subject} → ${f.recipients.join(", ")} (${f.age_days}d old, from ${f.source_meeting_title ?? "?"})`
    )
    .join("\n");

  const commitmentsBlock = args.commitments
    .slice(0, 8)
    .map(
      (c) =>
        `- ${c.title}${c.counterpart ? ` (to ${c.counterpart})` : ""}${c.do_by ? ` due ${c.do_by}` : ""}${c.days_overdue > 0 ? ` — ${c.days_overdue}d overdue` : ""}`
    )
    .join("\n");

  const tasksBlock = args.tasks
    .slice(0, 10)
    .map((t) => `- [${t.surface_reason}] ${t.title}`)
    .join("\n");

  const systemBlock = `You write a short, candid morning briefing for ${args.userDisplayName}, who manages multiple parallel client pursuits. The briefing is 3-5 sentences of plain prose. It opens the user's day. Voice: direct, brisk, no corporate fluff, no em dashes, no colon-punchlines, no "it's not just X, it's Y", no "delve" / "leverage" / "robust" / "seamless". Write the way a smart colleague would summarize the day in person.

The briefing should:
- Lead with the most important thing about today (the meeting that matters most, or the overdue commitment that needs unblocking, or the through-line across the day if there is one)
- Mention 1-3 things by name that the user should keep in mind
- Be honest if the day is light or routine
- End on a forward-leaning note, not a pleasantry

Do NOT list everything in the structured data — the user can see that on the page below your paragraph. Synthesize, don't enumerate.

Return ONLY the paragraph. No JSON wrapper, no headers, no markdown.`;

  const userBlock = `Date: ${args.briefingDate} (${args.dayOfWeek})
${args.userBio ? `\nUser context: ${args.userBio}\n` : ""}
Meetings today:
${meetingsBlock || "(none scheduled)"}

Pending follow-ups (older = more urgent):
${followUpsBlock || "(none)"}

Pressing commitments (overdue or due today):
${commitmentsBlock || "(none)"}

Today's task list:
${tasksBlock || "(empty)"}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": args.anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        temperature: 0.4,
        system: [
          {
            type: "text",
            text: systemBlock,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userBlock }],
      }),
    });

    if (!response.ok) {
      const txt = await response.text();
      console.error("[synthesize] Anthropic non-OK:", response.status, txt.slice(0, 500));
      return { intro: null, usage: {}, stopReason: null };
    }

    const ai = await response.json();
    const text = ai.content?.[0]?.text?.trim() ?? null;
    return { intro: text, usage: ai.usage ?? {}, stopReason: ai.stop_reason ?? null };
  } catch (err) {
    console.error("[synthesize] error:", err);
    return { intro: null, usage: {}, stopReason: null };
  }
}

function fallbackIntro(
  meetings: MeetingItem[],
  followUps: FollowUpItem[],
  commitments: CommitmentItem[],
  tasks: TaskItem[]
): string {
  const parts: string[] = [];
  if (meetings.length === 0) {
    parts.push("No meetings on the calendar today.");
  } else if (meetings.length === 1) {
    parts.push(`One meeting today: ${meetings[0].title ?? "(untitled)"}.`);
  } else {
    parts.push(`${meetings.length} meetings today.`);
  }
  const overdue = commitments.filter((c) => c.days_overdue > 0).length;
  if (overdue > 0) parts.push(`${overdue} commitment${overdue > 1 ? "s" : ""} overdue.`);
  if (followUps.length > 0) parts.push(`${followUps.length} follow-up${followUps.length > 1 ? "s" : ""} pending.`);
  if (tasks.length > 0) parts.push(`${tasks.length} task${tasks.length > 1 ? "s" : ""} surfaced.`);
  return parts.join(" ");
}

// ----------------------------------------------------------------------------
// Response helper
// ----------------------------------------------------------------------------

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
