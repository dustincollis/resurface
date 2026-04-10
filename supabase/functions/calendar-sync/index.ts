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
import { resolveAttendees } from "../_shared/resolve-identity.ts";

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

    let synced = 0;
    let updated = 0;
    let skipped = 0;

    // Helper: parse semicolon-separated email strings (Power Automate format)
    // e.g. "Holly_Quinones@epam.com;Tomasz_Balcerek@epam.com;Dustin_Collis@epam.com;"
    const parseSemicolonEmails = (raw: unknown): string[] => {
      if (typeof raw !== "string" || !raw.trim()) return [];
      return raw.split(";").map((s) => s.trim()).filter(Boolean);
    };

    // Helper: parse a start/end time value
    const parseTime = (raw: unknown): string | null => {
      if (typeof raw === "string" && raw.trim()) {
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d.toISOString();
      }
      if (raw && typeof raw === "object") {
        const obj = raw as { dateTime?: string; timeZone?: string };
        if (obj.dateTime) {
          const suffix = obj.timeZone === "UTC" ? "Z" : "";
          const d = new Date(obj.dateTime + suffix);
          return isNaN(d.getTime()) ? null : d.toISOString();
        }
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

    // Batch-check which external IDs already exist
    const externalIds = rows
      .map((r) => r.externalId)
      .filter((id): id is string => id !== null);

    const existingMap = new Map<string, string>();
    if (externalIds.length > 0) {
      const { data: existingRows } = await adminClient
        .from("meetings")
        .select("id, external_source_id")
        .eq("user_id", userId)
        .in("external_source_id", externalIds);
      for (const row of existingRows ?? []) {
        existingMap.set(row.external_source_id, row.id);
      }
    }

    // Process rows — updates and inserts
    for (const row of rows) {
      const existingId = row.externalId ? existingMap.get(row.externalId) : undefined;

      if (existingId) {
        await adminClient
          .from("meetings")
          .update({
            title: row.data.title,
            start_time: row.data.start_time,
            end_time: row.data.end_time,
            location: row.data.location,
            attendees: row.data.attendees,
          })
          .eq("id", existingId);
        updated++;
        continue;
      }

      const { error: insertErr } = await adminClient
        .from("meetings")
        .insert(row.data);

      if (insertErr) {
        const code = (insertErr as { code?: string }).code;
        if (code === "23505") { skipped++; continue; }
        console.error("[calendar-sync] insert error:", insertErr);
        skipped++;
        continue;
      }

      synced++;
    }

    // Resolve attendees → people and link via meeting_attendees junction.
    // Run async after the main sync to avoid slowing down the response.
    // We process all meetings that were synced or updated this run.
    try {
      const allMeetingIds: string[] = [];

      // Collect meeting IDs for newly inserted rows
      if (synced > 0 || updated > 0) {
        const { data: syncedMeetings } = await adminClient
          .from("meetings")
          .select("id, attendees")
          .eq("user_id", userId)
          .eq("source", "calendar_sync")
          .not("attendees", "is", null);

        for (const m of syncedMeetings ?? []) {
          const attendees: string[] = m.attendees ?? [];
          if (attendees.length === 0) continue;

          const personIds = await resolveAttendees(adminClient, userId, attendees);
          if (personIds.length > 0) {
            const junctionRows = personIds.map((pid: string) => ({
              meeting_id: m.id,
              person_id: pid,
            }));
            await adminClient.from("meeting_attendees").upsert(junctionRows, {
              onConflict: "meeting_id,person_id",
              ignoreDuplicates: true,
            });
          }
        }
      }
    } catch (linkErr) {
      // Don't fail the whole sync if identity resolution has issues
      console.warn("[calendar-sync] identity resolution warning:", linkErr);
    }

    return new Response(
      JSON.stringify({ ok: true, synced, updated, skipped, total: events.length }),
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
