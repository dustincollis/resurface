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

// Opus 4.7 for editorial voice quality — the morning briefing is one of
// the highest-leverage AI surfaces in the app (it opens the user's day).
// Cost delta vs Sonnet 4.6 at this volume (one call/user/day) is ~$3/year.
//
// Opus 4.7 specifics that affect this call:
//   - temperature/top_p/top_k removed (sending any returns 400). Don't pass.
//   - Adaptive thinking is OFF by default; we leave it off — a 3-5 sentence
//     summary doesn't need multi-step reasoning.
//   - Token counting differs from Sonnet, so max_tokens has a bit of headroom.
const MODEL = "claude-opus-4-7";

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
  // Flag meetings where the attendee list is just noise (recurring all-hands,
  // daily triage, etc.). Frontend hides the attendee block on these.
  is_recurring_noise: boolean;
  // Solo time-block: a calendar slot the user reserved to work on something
  // alone (e.g. "Review S&P", "Work on IDC Deck"). No other attendees.
  // Different render path than meetings — the title is the agenda, not a
  // discussion topic.
  is_time_block: boolean;
  // Optional reference to a prior meeting that this one is preparing for or
  // continuing from (e.g. "PREP: X" → the X meeting earlier in the week).
  related_prior_meeting: {
    id: string;
    title: string | null;
    start_time: string | null;
    one_line: string | null;
  } | null;
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

    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;
    // Optional: generate the briefing for an arbitrary date instead of "today".
    // Used for testing (preview tomorrow's briefing now) and for cron pre-warming
    // (cron passes the upcoming date explicitly so it doesn't depend on UTC vs.
    // local-time wall-clock alignment).
    const requestedDate =
      typeof body?.for_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.for_date)
        ? (body.for_date as string)
        : null;
    // Optional: when called via service role (cron / internal), pick the user
    // explicitly. JWT path always uses the authed user and ignores this.
    const requestedUserId =
      typeof body?.user_id === "string" && body.user_id.length > 0
        ? (body.user_id as string)
        : null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const defaultUserId = Deno.env.get("RESURFACE_DEFAULT_USER_ID");

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Three call paths, in order of trust:
    //   1. Service-role token  — internal / cron caller. May specify any user via
    //                            body.user_id (or fall back to RESURFACE_DEFAULT_USER_ID).
    //   2. User JWT            — browser. Uses the authed user; body.user_id is ignored.
    //   3. No auth header      — anonymous cron-style caller (matches compute-staleness
    //                            / retry-unprocessed). LOCKED to RESURFACE_DEFAULT_USER_ID.
    //                            body.user_id is IGNORED on this path — otherwise an
    //                            internet-routable URL with --no-verify-jwt would let any
    //                            caller request another user's briefing once multi-user is
    //                            enabled. The single-user app today doesn't suffer this,
    //                            but the schema is multi-user-ready and we don't want a
    //                            latent vulnerability sitting in the code waiting to fire.
    const token = authHeader ? authHeader.replace("Bearer ", "") : null;
    const isServiceRole = token !== null && token === serviceRoleKey;
    let userId: string;
    let userEmail: string | null = null;

    if (isServiceRole) {
      const candidate = requestedUserId ?? defaultUserId ?? null;
      if (!candidate) {
        return new Response(
          JSON.stringify({
            error:
              "Service-role caller must supply user_id (or RESURFACE_DEFAULT_USER_ID env).",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      userId = candidate;
    } else if (token === null) {
      // Anonymous path: lock to default user. Ignore body.user_id deliberately.
      if (!defaultUserId) {
        return new Response(
          JSON.stringify({
            error:
              "Anonymous calls require RESURFACE_DEFAULT_USER_ID env to be set.",
          }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      userId = defaultUserId;
    } else {
      const {
        data: { user },
      } = await adminClient.auth.getUser(token!);
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
      userEmail = user.email ?? null;
    }

    // ---- Determine the briefing date in the user's timezone ----
    const { data: profile } = await adminClient
      .from("profiles")
      .select("timezone, display_name, bio")
      .eq("id", userId)
      .single();
    const tz: string =
      (profile?.timezone as string | undefined) || "America/New_York";
    const userDisplayName: string =
      (profile?.display_name as string | undefined) || userEmail?.split("@")[0] || "the user";
    const userBio: string =
      (profile?.bio as string | undefined) || "";

    const briefingDate = requestedDate ?? ymdInTz(new Date(), tz);
    // Day-of-week derived from the briefing date itself so for_date previews
    // ("show me Friday's briefing") render correctly.
    const briefingDateForDow = new Date(`${briefingDate}T12:00:00Z`);
    const dayOfWeek = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: tz,
    }).format(briefingDateForDow);

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
    is_recurring_noise: false,
    is_time_block: false,
    related_prior_meeting: null,
  }));
}

// Detect meetings where listing every attendee is noise — recurring
// all-hands, daily triage, large internal cadences. Heuristic: title
// matches a known pattern. Frontend hides the attendee block on these.
function isRecurringNoiseMeeting(title: string | null): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  const patterns = [
    /\bdaily new deals triage\b/,
    /\bdep na\b.*\btriage\b/,
    /\bweekly sync\b/,
    /\bbi-?weekly\b.*\bsync\b/,
    /\bmonthly team\b/,
    /\bteam standup\b/,
    /\bdaily standup\b/,
    /\ball[- ]hands\b/,
    /\bops updates\b/,
  ];
  return patterns.some((p) => p.test(t));
}

// Normalize an attendee identifier (could be email, name, or speaker
// label) into candidate match keys. We try multiple lookups against the
// people table because Power Automate sends emails like
// "Alice_Pinti@epam.com" while the `people` table stores "Alice Pinti".
function attendeeMatchKeys(raw: string): {
  email: string | null;
  derivedName: string | null;
  rawName: string;
} {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  if (lower.includes("@")) {
    // Email — extract local part, replace _/. with space, title-case-ish for name match
    const local = lower.split("@")[0];
    const derivedName = local.replace(/[._]/g, " ").trim();
    return { email: lower, derivedName, rawName: lower };
  }
  return { email: null, derivedName: null, rawName: lower };
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

  // ---- Build people lookup with multiple match strategies ----
  // Power Automate sends emails ("Alice_Pinti@epam.com"); Jamie sends speaker
  // names ("Alice Pinti"). We need both to resolve to the same person row.
  const { data: people } = await db
    .from("people")
    .select("id, name, email, company_id, companies(name)")
    .eq("user_id", userId);

  const byEmail = new Map<string, Record<string, unknown>>();
  const byName = new Map<string, Record<string, unknown>>();
  for (const p of people ?? []) {
    const email = ((p.email as string) ?? "").trim().toLowerCase();
    const name = ((p.name as string) ?? "").trim().toLowerCase();
    if (email) byEmail.set(email, p);
    if (name) {
      byName.set(name, p);
      // Alias: also key on first word ("Beth" matches "Beth Smith") and on
      // underscored variants ("alice_pinti" → "alice pinti")
      if (name.includes(" ")) {
        const first = name.split(" ")[0];
        if (first && !byName.has(first)) byName.set(first, p);
      }
    }
  }

  // Pull all open commitments for matching against attendees.
  const { data: commitments } = await db
    .from("commitments")
    .select("id, title, direction, counterpart, company, do_by, status")
    .eq("user_id", userId)
    .eq("status", "open");
  const commitmentsList = (commitments ?? []) as Array<Record<string, unknown>>;

  // ---- Pull recent meetings (last 14 days) to find prior context ----
  // For each of today's meetings, see if there's a recent prior meeting
  // with similar title (substring match) or strong attendee overlap. Use
  // its transcript_summary as context for the briefing.
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: priorMeetings } = await db
    .from("meetings")
    .select("id, title, start_time, transcript_summary, attendees")
    .eq("user_id", userId)
    .gte("start_time", fourteenDaysAgo)
    .lt("start_time", meetings[0]?.start_time ?? new Date().toISOString())
    .not("transcript_summary", "is", null)
    .order("start_time", { ascending: false })
    .limit(80);
  const priorList = (priorMeetings ?? []) as Array<Record<string, unknown>>;

  // ---- Skip lists ----
  const isPlaceholder = (raw: string): boolean => {
    const lower = raw.trim().toLowerCase();
    return (
      lower === "speaker -1" ||
      lower.startsWith("speaker ") ||
      lower === "dustin" ||
      lower === "dustin collis" ||
      lower.endsWith("@epam.com") && (lower.startsWith("dustin_collis") || lower.startsWith("dustin.collis"))
    );
  };

  // ---- Build attendee_context per meeting ----
  const out: MeetingItem[] = [];
  for (const m of meetings) {
    const ctx: AttendeeContext[] = [];
    for (const raw of m.attendees) {
      if (isPlaceholder(raw)) continue;

      const keys = attendeeMatchKeys(raw);
      const person =
        (keys.email && byEmail.get(keys.email)) ||
        (keys.derivedName && byName.get(keys.derivedName)) ||
        byName.get(keys.rawName) ||
        byName.get(keys.rawName.split(" ")[0]);

      const company =
        ((person?.companies as Record<string, unknown> | undefined)?.name as string) ?? null;
      const personId = (person?.id as string) ?? null;
      // Use the person's canonical name if we found a match, otherwise keep
      // the raw email/name (better than rendering Alice_Pinti@epam.com).
      const displayName = person
        ? ((person.name as string) || raw)
        : keys.derivedName
          ? keys.derivedName.replace(/\b\w/g, (c) => c.toUpperCase())
          : raw;

      // Open commitments where counterpart or company matches.
      const lookupKeys = [
        keys.rawName,
        keys.derivedName,
        ((person?.name as string) ?? "").toLowerCase(),
      ].filter(Boolean) as string[];

      const open: AttendeeContext["open_commitments"] = [];
      for (const c of commitmentsList) {
        const cp = ((c.counterpart as string) ?? "").trim().toLowerCase();
        const cc = ((c.company as string) ?? "").trim().toLowerCase();
        const matchesPerson = cp && lookupKeys.some((k) => cp === k || cp === k.split(" ")[0]);
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
        name: displayName,
        person_id: personId,
        company,
        last_seen_meeting_date: null,
        open_commitments: open,
      });
    }

    // ---- Detect recurring noise meetings ----
    const isNoise = isRecurringNoiseMeeting(m.title);

    // ---- Detect solo time-blocks ----
    // A solo time-block: the meeting has no other attendees besides the
    // user (or no attendees at all on the calendar invite). The title is
    // the agenda — what the user reserved this slot to do.
    const isTimeBlock = !isNoise && ctx.length === 0 && (
      m.attendees.length === 0 ||
      m.attendees.every((a) => isPlaceholder(a))
    );

    // ---- Find related prior meeting ----
    // Skip on noise meetings; allow on time-blocks (e.g. "Work on IDC
    // Deck" → the IDC Marketscape conversation that warrants the work).
    const related = isNoise ? null : findRelatedPriorMeeting(m, priorList);

    out.push({
      ...m,
      attendee_context: ctx,
      is_recurring_noise: isNoise,
      is_time_block: isTimeBlock,
      related_prior_meeting: related,
    });
  }
  return out;
}

// Heuristic: find a prior meeting in the last 14 days that's likely the
// real meeting this one is preparing for, or a recurring instance of the
// same topic. Strategy:
//   1. If title starts with "PREP", "Prep", "Prep for", "Prep:" → strip
//      that prefix and search for a prior meeting whose title contains
//      the remainder (case-insensitive).
//   2. Otherwise, look for prior meetings with title that shares a long
//      substring with this one (≥ 8 chars) — handles recurring meetings
//      that share a name across weeks.
//   3. Take the most recent match. Surface its title + a one-line
//      summary (first sentence of transcript_summary if any).
function findRelatedPriorMeeting(
  meeting: MeetingItem,
  priors: Array<Record<string, unknown>>
): MeetingItem["related_prior_meeting"] {
  if (!meeting.title) return null;
  const myTitle = meeting.title.toLowerCase();

  // Strip prep prefixes
  const stripped = myTitle
    .replace(/^prep(\s+for)?[:\s]+/i, "")
    .replace(/^preparing\s+for[:\s]+/i, "")
    .trim();

  // Tokenize and drop stopwords — we'll match on significant-word overlap.
  // This handles word-order differences ("IDC Adobe Services" vs "Adobe
  // Services IDC Marketscape") and partial overlap ("PREP: Adobe Services
  // IDC Marketscape" matches "Adobe Services IDC Reading").
  // Stopwords: filler + the user's own name (it's in every meeting they're
  // part of, so matching on it is meaningless).
  const STOPWORDS = new Set([
    "a", "an", "and", "the", "for", "to", "of", "with", "on", "in",
    "is", "at", "by", "as", "or", "vs", "x",
    "prep", "review", "sync", "call", "meeting", "discuss",
    "discussion", "update", "weekly", "monthly", "biweekly", "daily",
    "quick", "intro", "introduction", "follow",
    // User's own name
    "dustin", "collis",
  ]);
  const tokens = (s: string): string[] =>
    s.split(/[\s\W]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));

  const myTokens = new Set(tokens(stripped));
  if (myTokens.size === 0) return null;

  let best: Record<string, unknown> | null = null;
  let bestOverlap = 0;
  for (const p of priors) {
    const t = ((p.title as string) ?? "").toLowerCase();
    if (!t) continue;
    // Note: NOT excluding same-title priors. A recurring meeting (same
    // title, different date) IS exactly what we want to surface as
    // "context from last time."
    const theirTokens = new Set(tokens(t));
    let overlap = 0;
    for (const tok of myTokens) if (theirTokens.has(tok)) overlap++;
    // Require overlap ≥ 2 always. Single-token overlap (e.g. just
    // "Adobe" or "Sitecore") is too noisy — those terms appear across
    // many unrelated meetings.
    if (overlap >= 2 && overlap > bestOverlap) {
      best = p;
      bestOverlap = overlap;
    }
  }
  if (!best) return null;

  // Extract a one-line summary: first sentence of transcript_summary,
  // skipping markdown headers.
  const summary = (best.transcript_summary as string) ?? "";
  const firstParagraph = summary
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#") && !l.startsWith("##") && l.length > 20);
  const oneLine = firstParagraph
    ? firstParagraph.split(/(?<=[.!?])\s+/)[0].slice(0, 220)
    : null;

  return {
    id: best.id as string,
    title: (best.title as string) ?? null,
    start_time: (best.start_time as string) ?? null,
    one_line: oneLine,
  };
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
      // Tag the meeting type so the model knows how to interpret it.
      const tag = m.is_time_block
        ? "[SOLO TIME-BLOCK — user reserved this slot to work on this]"
        : m.is_recurring_noise
          ? "[RECURRING CADENCE]"
          : "";
      // Attendee list: omit for solo blocks (none) and recurring noise.
      const attendees = m.is_time_block || m.is_recurring_noise
        ? ""
        : m.attendee_context
            .map((a) => `${a.name}${a.company ? ` [${a.company}]` : ""}`)
            .join(", ") || "(internal, no other attendees resolved)";
      const openCommits = m.attendee_context
        .flatMap((a) => a.open_commitments)
        .map((c) => `${c.direction === "outgoing" ? "owed to them" : "owed by them"}: ${c.title}`)
        .slice(0, 3)
        .join("; ");
      const prior = m.related_prior_meeting?.one_line
        ? ` | prior context: "${m.related_prior_meeting.one_line}"`
        : "";
      const parts = [
        `- ${time} ${m.title ?? "(untitled)"}`,
        tag,
        attendees ? `with ${attendees}` : "",
        openCommits ? `open commitments: ${openCommits}` : "",
        prior,
      ].filter(Boolean);
      // Use pipe separator (not em dash) so the model doesn't mirror em
      // dashes from the input into its output paragraph.
      return parts.join(" | ");
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

  const systemBlock = `You write a short factual preview of ${args.userDisplayName}'s day. NOT a coach, NOT a planner, NOT a priority-ranker. Resurface only knows what's in its database, which is a small slice of the whole. Don't pretend to more context than you have.

**The bar for saying anything:** is it a fact you can point to in the structured data below, or are you guessing? If you're guessing, leave it out.

**Format — break it up. No walls of text.**
- 2 or 3 short paragraphs. Each paragraph is 1-2 sentences max.
- Separate paragraphs with a blank line (\\n\\n). The user reads this on a phone in the morning; dense prose is harder to scan.
- Plain prose. No headers, no bullets, no markdown, no quotes.

**Suggested rhythm** (don't force this — only follow if the facts fit):
- Paragraph 1: shape of the day. How many meetings, whether they cluster, whether they're mostly internal or include external partners, whether the user has reserved any time-blocks to work on specific things.
- Paragraph 2: the most notable cross-reference, if any — overdue commitment to someone on today's calendar, a recurring topic surfacing again, a prep meeting that connects to a real meeting later.
- Paragraph 3 (only if needed): an exception worth flagging — something genuinely unusual about today.

**Time-blocks** (meetings flagged \`is_time_block\`): these are slots the user reserved to do focused work alone. The title is the agenda — what they're working on. Treat them as planned work, not as meetings: "two blocks of focused work — reviewing the S&P deck and prepping for the Hi-tech call." Don't try to find attendees or commitments on them; they're solo.

**What to include** (only when factual):
- Counts and clusters: "three back-to-back from 9:00 to 10:30"
- Specific people/companies named in the data: "Mo Mirpuri is on today's calendar"
- Cross-references between data sources: "the commitment to follow up with Alexandra is three days overdue, and she's in the 9:00 prep meeting"
- Time-blocks the user has set aside: "two solo blocks for the IDC deck and the S&P review"

**What NOT to write:**
- No prescriptive language: "make sure to", "before X, do Y", "squeeze in", "go in with a clear ask", "this is your one chance". You don't know enough to give those instructions.
- No invented through-lines: "X is the spine of your day", "everything is feeding the same story". Guesses dressed up as observations. Cut them.
- No editorial framing of priority. Don't decide what matters most.
- No corporate fluff: no em dashes, no colon-punchlines, no "delve / leverage / robust / seamless / navigate".

Return ONLY the paragraphs, separated by blank lines. No preamble.`;

  // Pre-compute counts so the model doesn't have to count the list itself
  // (LLMs are surprisingly bad at counting). Quote these verbatim if the
  // intro mentions counts at all.
  const totalItems = args.meetings.length;
  const timeBlockCount = args.meetings.filter((m) => m.is_time_block).length;
  const recurringCount = args.meetings.filter((m) => m.is_recurring_noise).length;
  const realMeetingCount = totalItems - timeBlockCount - recurringCount;

  const countsLine = `Counts (use these verbatim — do not recount the list):
- Total items on calendar: ${totalItems}
- Real meetings with other people: ${realMeetingCount}
- Solo time-blocks reserved for focused work: ${timeBlockCount}
- Recurring cadences (large all-hands / daily triage): ${recurringCount}`;

  const userBlock = `Date: ${args.briefingDate} (${args.dayOfWeek})
${args.userBio ? `\nUser context: ${args.userBio}\n` : ""}
${countsLine}

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
        max_tokens: 600,
        // No prompt cache marker: Sonnet 4.6 minimum cacheable prefix is 2048
        // tokens and Opus 4.7's is 4096 — our system block (~250 tokens) sits
        // far below either, so cache_control would be silent no-op overhead.
        // If/when this prompt grows past 4096 tokens (e.g. by inlining the
        // follow-up voice guide), add cache_control back on the system block.
        // No temperature: Opus 4.7 removed sampling parameters entirely.
        system: systemBlock,
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
