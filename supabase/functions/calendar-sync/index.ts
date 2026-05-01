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
    // Scoped to just the rows we touched this run, not every calendar_sync
    // row that ever existed. Failures here don't fail the whole sync —
    // identity resolution is best-effort backfill.
    try {
      for (const m of upserted) {
        const attendees = m.attendees ?? [];
        if (attendees.length === 0) continue;
        const personIds = await resolveAttendees(adminClient, userId, attendees);
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
