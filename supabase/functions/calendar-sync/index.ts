// calendar-sync: receives calendar events from Power Automate (or any
// external calendar source) and upserts them into the meetings table.
//
// Power Automate sends a JSON array of upcoming events. Each event
// becomes a meeting row with source='calendar_sync'. Existing events
// are matched by external_source_id (using the Outlook event ID) so
// re-syncs don't create duplicates — they update titles/times instead.
//
// Auth: shared API key in x-calendar-sync-key header (same pattern as
// the Jamie webhook). Requires CALENDAR_SYNC_API_KEY secret.
//
// Deploy with --no-verify-jwt:
//   supabase functions deploy calendar-sync --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import { createIdentityResolver } from "../_shared/resolve-identity.ts";

// Power Automate's Outlook connector helpfully wraps email strings as
// markdown links: "[name@x.com](mailto:name@x.com)". Strip back to the
// raw email so identity resolution works (and we don't end up with
// people rows whose names are markdown blobs).
function unwrapMarkdownEmail(s: string): string {
  const m = s.match(/^\[([^\]]+@[^\]]+)\]\(mailto:[^)]+\)$/);
  return m ? m[1] : s;
}

// Above this attendee count, a meeting is a broadcast (all-hands, RTBs,
// org-wide invites) and per-attendee identity resolution adds no signal —
// we'd just be creating ephemeral people rows for every one-off recipient.
// The meeting still upserts with the full attendees array intact; we just
// don't try to resolve each name to a person record.
const ATTENDEE_RESOLUTION_CAP = 30;

// Windows → IANA timezone map. Power Automate's Outlook connector sends
// the user's mailbox timezone using Windows naming ("Eastern Standard
// Time"); Intl.DateTimeFormat needs IANA ("America/New_York"). Covers
// the timezones the user's mailbox + correspondents are likely to use.
// Unknown values fall back to UTC (safe — worst case is the legacy
// behavior, which is what we had before this fix).
const WINDOWS_TZ_MAP: Record<string, string> = {
  "UTC": "UTC",
  "Coordinated Universal Time": "UTC",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "US Mountain Standard Time": "America/Phoenix",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Atlantic Standard Time": "America/Halifax",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw",
  "Central Europe Standard Time": "Europe/Budapest",
  "FLE Standard Time": "Europe/Helsinki",
  "Russian Standard Time": "Europe/Moscow",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "Singapore Standard Time": "Asia/Singapore",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
  "SA Pacific Standard Time": "America/Bogota",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
};

function windowsToIana(tz: string): string {
  if (!tz) return "UTC";
  // If already IANA-style (contains a slash), trust it as-is.
  if (tz.includes("/")) return tz;
  return WINDOWS_TZ_MAP[tz] ?? "UTC";
}

// Convert a wall-clock datetime string (in the named IANA tz) to a UTC
// ISO string. Uses Intl.DateTimeFormat to compute the offset at the
// approximate instant, then adjusts. Handles DST correctly because the
// formatter is given the actual instant, not the year alone.
function localToUtcIso(naive: string, iana: string): string | null {
  const guessUtcMs = Date.parse(naive + "Z");
  if (isNaN(guessUtcMs)) return null;
  if (iana === "UTC") return new Date(guessUtcMs).toISOString();
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: iana,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    // Unknown IANA name — fall back to naive UTC.
    return new Date(guessUtcMs).toISOString();
  }
  const parts = fmt.formatToParts(new Date(guessUtcMs));
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  if (!m.year) return new Date(guessUtcMs).toISOString();
  const actualLocalMs = Date.parse(
    `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}:${m.second}Z`
  );
  if (isNaN(actualLocalMs)) return new Date(guessUtcMs).toISOString();
  // guessUtcMs - actualLocalMs = how far ahead the naive guess is from
  // what the tz says the same instant should look like. Add that diff
  // back to the guess to get the real UTC.
  const diffMs = guessUtcMs - actualLocalMs;
  return new Date(guessUtcMs + diffMs).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Auth: shared API key
    const expectedKey = Deno.env.get("CALENDAR_SYNC_API_KEY");
    if (!expectedKey) {
      return new Response(
        JSON.stringify({ error: "Server misconfigured: CALENDAR_SYNC_API_KEY not set" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const presentedKey =
      req.headers.get("x-calendar-sync-key") ??
      req.headers.get("x-api-key") ?? "";
    if (presentedKey !== expectedKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = Deno.env.get("RESURFACE_DEFAULT_USER_ID");
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Server misconfigured: RESURFACE_DEFAULT_USER_ID not set" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Accept either a single event or an array of events.
    // Power Automate's "Apply to each" may send one at a time,
    // or a batch depending on how the flow is built.
    const events: Record<string, unknown>[] = Array.isArray(body)
      ? body
      : body.events
        ? (body.events as Record<string, unknown>[])
        : body.subject || body.title || body.id
          ? [body]
          : [];

    if (events.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, synced: 0, message: "No events in payload" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let skipped = 0;

    // Helper: parse semicolon-separated email strings (Power Automate format)
    // e.g. "Holly_Quinones@epam.com;Tomasz_Balcerek@epam.com;Dustin_Collis@epam.com;"
    // Also handles markdown-wrapped emails that Power Automate's connector
    // sometimes emits: "[name@x.com](mailto:name@x.com)" → "name@x.com".
    const parseSemicolonEmails = (raw: unknown): string[] => {
      if (typeof raw !== "string" || !raw.trim()) return [];
      return raw
        .split(";")
        .map((s) => unwrapMarkdownEmail(s.trim()))
        .filter(Boolean);
    };

    // Helper: parse a start/end time value.
    //
    // Power Automate's Outlook connector sends events with two shapes:
    //   { dateTime: "2026-05-13T08:30:00", timeZone: "Eastern Standard Time" }
    //   { dateTime: "2026-05-13T12:30:00", timeZone: "UTC" }
    //
    // The older version only handled the "UTC" case; anything else got
    // naive-parsed (treated as UTC even though it was local), producing
    // a 4-hour shift for ET users that displayed as 4 AM events.
    //
    // Fix: when timeZone is non-UTC, map the Windows TZ name to an IANA
    // zone and compute the true UTC instant via Intl.DateTimeFormat (no
    // external lib needed — V8/Deno honors timeZone in formatToParts).
    const parseTime = (raw: unknown): string | null => {
      if (typeof raw === "string" && raw.trim()) {
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d.toISOString();
      }
      if (raw && typeof raw === "object") {
        const obj = raw as { dateTime?: string; timeZone?: string };
        if (!obj.dateTime) return null;
        const naive = obj.dateTime.replace(/Z$/, "");
        const tz = obj.timeZone ?? "UTC";
        if (tz === "UTC" || tz === "") {
          const d = new Date(naive + "Z");
          return isNaN(d.getTime()) ? null : d.toISOString();
        }
        const iana = windowsToIana(tz);
        return localToUtcIso(naive, iana);
      }
      return null;
    };

    // Pre-process: build upsert rows, skipping cancelled/all-day/empty
    const rows: { externalId: string | null; data: Record<string, unknown> }[] = [];

    for (const event of events) {
      const eventId = (event.id ?? event.eventId ?? event.event_id) as string | undefined;
      const subject = (event.subject ?? event.title ?? event.name ?? "") as string;
      const isAllDay = event.isAllDay as boolean | undefined;
      const isCancelled =
        (event.isCancelled as boolean) ??
        ((event.showAs as string) === "free" && !subject);

      if (!subject && !eventId) { skipped++; continue; }
      if (isCancelled) { skipped++; continue; }
      if (isAllDay) { skipped++; continue; }

      // Parse attendees — handle both Graph array-of-objects and
      // Power Automate's semicolon-separated email strings
      const attendees: string[] = [];
      const attendeesRaw = event.attendees;
      if (Array.isArray(attendeesRaw)) {
        for (const a of attendeesRaw) {
          if (typeof a === "string") attendees.push(a);
          else if (a?.emailAddress?.name) attendees.push(a.emailAddress.name);
          else if (a?.emailAddress?.address) attendees.push(a.emailAddress.address);
        }
      }
      // Power Automate Outlook connector uses requiredAttendees / optionalAttendees
      attendees.push(...parseSemicolonEmails(event.requiredAttendees));
      attendees.push(...parseSemicolonEmails(event.optionalAttendees));
      // Deduplicate
      const uniqueAttendees = [...new Set(attendees)];

      // Parse location
      const locRaw = event.location;
      let locationStr: string | null = null;
      if (typeof locRaw === "string" && locRaw.trim()) {
        locationStr = locRaw.trim();
      } else if (locRaw && typeof locRaw === "object" && (locRaw as { displayName?: string }).displayName) {
        locationStr = (locRaw as { displayName: string }).displayName;
      }

      const externalId = eventId ? `outlook:event:${eventId}` : null;

      rows.push({
        externalId,
        data: {
          user_id: userId,
          title: subject || "Untitled meeting",
          start_time: parseTime(event.start),
          end_time: parseTime(event.end),
          location: locationStr,
          attendees: uniqueAttendees,
          source: "calendar_sync",
          import_mode: "active",
          external_source_id: externalId,
        },
      });
    }

    // Bulk upsert — single round-trip for the whole batch. The unique
    // partial index on (user_id, external_source_id) WHERE external_source_id
    // IS NOT NULL (migration 20260409020000) handles the conflict resolution.
    // Rows without an external_source_id always insert (NULL is not equal
    // to NULL in unique constraints), which is the right behavior for
    // events that lack an Outlook ID.
    //
    // .select() returns the upserted rows so we know which meetings to
    // run identity resolution against, instead of scanning every
    // calendar_sync row in the table.
    const upsertPayload = rows.map((r) => r.data);
    let upserted: Array<{ id: string; attendees: string[] | null }> = [];

    if (upsertPayload.length > 0) {
      const { data, error: upsertErr } = await adminClient
        .from("meetings")
        .upsert(upsertPayload, {
          onConflict: "user_id,external_source_id",
          ignoreDuplicates: false,
        })
        .select("id, attendees");

      if (upsertErr) {
        console.error("[calendar-sync] upsert error:", upsertErr);
        return new Response(
          JSON.stringify({
            error: "Bulk upsert failed",
            detail: upsertErr.message,
            code: (upsertErr as { code?: string }).code ?? null,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      upserted = (data ?? []) as Array<{ id: string; attendees: string[] | null }>;
    }

    // Resolve attendees → people and link via meeting_attendees junction.
    // Run this in the background after responding — Power Automate's HTTP
    // action gives up if we sit on the response while we resolve hundreds
    // of attendees. The meeting upsert itself is already done; identity
    // resolution is best-effort backfill that just connects already-stored
    // attendees to person records.
    //
    // Three additional cost-control measures vs the prior implementation:
    //   1. Share ONE resolver across all meetings — the old code created a
    //      fresh resolver per meeting, which meant N full-table preloads of
    //      people + companies. Now it's one preload for the whole batch.
    //   2. Cap per-meeting at ATTENDEE_RESOLUTION_CAP. Above that threshold
    //      the meeting is a broadcast (RTB, all-hands) and each attendee is
    //      a one-off the user has no relationship with — resolving them
    //      adds noise, not signal.
    //   3. Failures don't propagate — log and continue.
    const resolver = createIdentityResolver(adminClient, userId);
    const backgroundWork = (async () => {
      try {
        await resolver.preload();
        for (const m of upserted) {
          const attendees = m.attendees ?? [];
          if (attendees.length === 0) continue;
          if (attendees.length > ATTENDEE_RESOLUTION_CAP) {
            console.log(
              `[calendar-sync] skipping identity resolution for meeting ${m.id} (${attendees.length} attendees, cap is ${ATTENDEE_RESOLUTION_CAP})`,
            );
            continue;
          }
          const personIds = await resolver.resolveAttendees(attendees);
          if (personIds.length === 0) continue;
          const junctionRows = personIds.map((pid: string) => ({
            meeting_id: m.id,
            person_id: pid,
          }));
          await adminClient.from("meeting_attendees").upsert(junctionRows, {
            onConflict: "meeting_id,person_id",
            ignoreDuplicates: true,
          });
        }
      } catch (linkErr) {
        console.warn("[calendar-sync] identity resolution warning:", linkErr);
      }
    })();

    // Hand the background promise to the runtime so it isn't killed when
    // we return. Falls through cleanly on local dev / older runtimes that
    // don't expose EdgeRuntime — there the work just runs in-line because
    // we still hold a reference to the promise (but the response is sent
    // first, so Power Automate isn't blocked either way).
    // deno-lint-ignore no-explicit-any
    const er = (globalThis as any).EdgeRuntime;
    if (er && typeof er.waitUntil === "function") {
      er.waitUntil(backgroundWork);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed: upserted.length,
        skipped,
        total: events.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[calendar-sync] error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
