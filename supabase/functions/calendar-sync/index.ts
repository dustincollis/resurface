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

    for (const event of events) {
      // Extract fields — Power Automate uses Microsoft Graph field names
      const eventId = (event.id ?? event.eventId ?? event.event_id) as string | undefined;
      const subject = (event.subject ?? event.title ?? event.name ?? "") as string;
      const startRaw = event.start as
        | string
        | { dateTime?: string; timeZone?: string }
        | undefined;
      const endRaw = event.end as
        | string
        | { dateTime?: string; timeZone?: string }
        | undefined;
      const location = (
        event.location ??
        (event.location as { displayName?: string })?.displayName ??
        ""
      ) as string;
      const attendeesRaw = event.attendees as
        | Array<{ emailAddress?: { name?: string; address?: string } } | string>
        | undefined;
      const isAllDay = event.isAllDay as boolean | undefined;
      const isCancelled =
        (event.isCancelled as boolean) ??
        ((event.showAs as string) === "free" && !subject);

      if (!subject && !eventId) {
        skipped++;
        continue;
      }

      // Parse start/end times
      let startTime: string | null = null;
      let endTime: string | null = null;
      if (typeof startRaw === "string") {
        startTime = new Date(startRaw).toISOString();
      } else if (startRaw?.dateTime) {
        // Microsoft Graph returns { dateTime: "2026-04-11T09:00:00.0000000", timeZone: "UTC" }
        startTime = new Date(startRaw.dateTime + (startRaw.timeZone === "UTC" ? "Z" : "")).toISOString();
      }
      if (typeof endRaw === "string") {
        endTime = new Date(endRaw).toISOString();
      } else if (endRaw?.dateTime) {
        endTime = new Date(endRaw.dateTime + (endRaw.timeZone === "UTC" ? "Z" : "")).toISOString();
      }

      // Parse attendees
      const attendees: string[] = [];
      if (Array.isArray(attendeesRaw)) {
        for (const a of attendeesRaw) {
          if (typeof a === "string") {
            attendees.push(a);
          } else if (a?.emailAddress?.name) {
            attendees.push(a.emailAddress.name);
          } else if (a?.emailAddress?.address) {
            attendees.push(a.emailAddress.address);
          }
        }
      }

      // Parse location
      let locationStr: string | null = null;
      if (typeof location === "string" && location.trim()) {
        locationStr = location.trim();
      } else if (typeof location === "object" && (location as { displayName?: string })?.displayName) {
        locationStr = (location as { displayName: string }).displayName;
      }

      const externalId = eventId ? `outlook:event:${eventId}` : null;

      // Skip cancelled events
      if (isCancelled) {
        skipped++;
        continue;
      }

      // Skip all-day events (typically out-of-office, holidays — not meetings)
      if (isAllDay) {
        skipped++;
        continue;
      }

      const meetingData: Record<string, unknown> = {
        user_id: userId,
        title: subject || "Untitled meeting",
        start_time: startTime,
        end_time: endTime,
        location: locationStr,
        attendees,
        source: "calendar_sync",
        import_mode: "active",
        external_source_id: externalId,
      };

      if (externalId) {
        // Check if this event already exists
        const { data: existing } = await adminClient
          .from("meetings")
          .select("id")
          .eq("external_source_id", externalId)
          .eq("user_id", userId)
          .maybeSingle();

        if (existing) {
          // Update title/time/attendees (event may have been rescheduled)
          await adminClient
            .from("meetings")
            .update({
              title: meetingData.title,
              start_time: meetingData.start_time,
              end_time: meetingData.end_time,
              location: meetingData.location,
              attendees: meetingData.attendees,
            })
            .eq("id", (existing as { id: string }).id);
          updated++;
          continue;
        }
      }

      // Insert new meeting
      const { error: insertErr } = await adminClient
        .from("meetings")
        .insert(meetingData);

      if (insertErr) {
        const code = (insertErr as { code?: string }).code;
        if (code === "23505") {
          // Duplicate — already synced
          skipped++;
          continue;
        }
        console.error("[calendar-sync] insert error:", insertErr);
        skipped++;
        continue;
      }

      synced++;
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
