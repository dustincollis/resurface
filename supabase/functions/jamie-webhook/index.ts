// Jamie webhook receiver.
//
// Jamie (meetjamie.ai) fires `meeting.completed` POST requests to this
// endpoint when a recording finishes processing. We:
//   1. Verify the shared API key from the header
//   2. Parse Jamie's payload (metadata + summary + speaker-attributed transcript)
//   3. Create a meeting row with the speaker-named transcript ready to parse
//   4. Invoke ai-parse-transcript via service role to run extraction
//   5. Return 200 to Jamie
//
// Required Supabase secrets:
//   JAMIE_WEBHOOK_API_KEY     — shared secret Jamie sends in x-jamie-api-key
//   RESURFACE_DEFAULT_USER_ID — UUID of the user the meetings belong to
//
// Deploy with --no-verify-jwt:
//   supabase functions deploy jamie-webhook --no-verify-jwt
//
// Configure in Jamie:
//   URL:    https://<project>.supabase.co/functions/v1/jamie-webhook
//   Header: x-jamie-api-key: <the secret>
//   Event:  meeting.completed

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveAttendees } from "../_shared/resolve-identity.ts";

const JAMIE_API_KEY_HEADERS = ["x-jamie-api-key", "x-api-key"];

// ============================================================
// Helpers
// ============================================================

function formatOffset(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// Be defensive about Jamie's exact field names — the spec we have shows
// speakerId + speakerName but doesn't pin the text/timestamp field names.
// Try the most common variants in order.
function pickText(seg: Record<string, unknown>): string | null {
  for (const key of ["text", "content", "sentence", "transcript", "body"]) {
    const v = seg[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

function pickStartMs(seg: Record<string, unknown>): number | null {
  for (const key of ["startTime", "beginTime", "start_time", "begin_time", "timestamp", "ts", "start"]) {
    const v = seg[key];
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (isFinite(n)) return n;
    }
  }
  return null;
}

interface JamieSegment {
  speakerName: string | null;
  text: string;
  startMs: number | null;
}

function parseTranscriptArray(transcript: unknown): JamieSegment[] {
  if (!Array.isArray(transcript)) return [];
  const out: JamieSegment[] = [];
  for (const raw of transcript) {
    if (!raw || typeof raw !== "object") continue;
    const seg = raw as Record<string, unknown>;
    const text = pickText(seg);
    if (!text) continue;
    const speakerName =
      typeof seg.speakerName === "string" && seg.speakerName.trim().length > 0
        ? (seg.speakerName as string).trim()
        : typeof seg.speaker === "string" && (seg.speaker as string).trim().length > 0
          ? (seg.speaker as string).trim()
          : typeof seg.speakerId === "string"
            ? `Speaker ${seg.speakerId as string}`
            : null;
    out.push({
      speakerName,
      text,
      startMs: pickStartMs(seg),
    });
  }
  return out;
}

function formatTranscript(segments: JamieSegment[]): string {
  return segments
    .map((s) => {
      const stamp = s.startMs != null ? `[${formatOffset(s.startMs)}] ` : "";
      const who = s.speakerName ? `${s.speakerName}: ` : "";
      return `${stamp}${who}${s.text}`;
    })
    .join("\n");
}

function uniqueSpeakers(segments: JamieSegment[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of segments) {
    if (s.speakerName && !seen.has(s.speakerName)) {
      seen.add(s.speakerName);
      out.push(s.speakerName);
    }
  }
  return out;
}

// Pull a sensible title out of Jamie's payload. Tries the metadata title
// field first, then the summary's first heading, then a generated one.
function deriveTitle(payload: Record<string, unknown>): string {
  const meta = (payload.metadata as Record<string, unknown>) ?? {};
  const data = (payload.data as Record<string, unknown>) ?? {};
  const summary = (data.summary as Record<string, unknown>) ?? {};

  for (const candidate of [meta.title, meta.name, data.title, summary.title]) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  // Try first heading line of the summary markdown
  const md = summary.markdown;
  if (typeof md === "string") {
    const m = md.match(/^#{1,3}\s+(.+)$/m);
    if (m) return m[1].trim();
  }

  return "Untitled discussion";
}

function deriveStartTimeISO(payload: Record<string, unknown>): string | null {
  const meta = (payload.metadata as Record<string, unknown>) ?? {};
  const data = (payload.data as Record<string, unknown>) ?? {};

  // Try a few likely field locations / units
  const candidates = [
    meta.startTime, meta.start_time, meta.recordedAt, meta.recorded_at,
    data.startTime, data.start_time, meta.created,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c) {
      const d = new Date(c);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    if (typeof c === "number" && isFinite(c)) {
      // Epoch in seconds vs millis: numbers under ~10^12 are seconds
      const ms = c < 1e12 ? c * 1000 : c;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

// ============================================================
// Handler
// ============================================================

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
    // ----- Auth: shared API key -----
    const expectedKey = Deno.env.get("JAMIE_WEBHOOK_API_KEY");
    if (!expectedKey) {
      return new Response(
        JSON.stringify({
          error: "Server misconfigured: JAMIE_WEBHOOK_API_KEY not set",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let presentedKey: string | null = null;
    for (const header of JAMIE_API_KEY_HEADERS) {
      const v = req.headers.get(header);
      if (v) {
        presentedKey = v;
        break;
      }
    }
    if (!presentedKey || presentedKey !== expectedKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ----- User attribution -----
    const userId = Deno.env.get("RESURFACE_DEFAULT_USER_ID");
    if (!userId) {
      return new Response(
        JSON.stringify({
          error: "Server misconfigured: RESURFACE_DEFAULT_USER_ID not set",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ----- Supabase admin client (needed early for webhook logging) -----
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // ?? doesn't fall through when an env var resolves to "" (the new
    // canonical var is SB_SERVICE_ROLE_KEY; the legacy var may still be
    // present but empty). Use || with "" defaults so the first non-empty
    // value wins. Mirrors ai-parse-transcript's env handling.
    const serviceRoleKeyLegacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const serviceRoleKeyNew = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";
    const serviceRoleKey = serviceRoleKeyNew || serviceRoleKeyLegacy;
    if (!serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "No service role key in env" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // ----- Parse payload -----
    const payload = (await req.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!payload) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ----- Log raw payload for disaster recovery -----
    const logExternalId = (() => {
      const m = (payload.metadata as Record<string, unknown>) ?? {};
      const raw = m.id ?? m.meetingId ?? m.meeting_id;
      return typeof raw === "string" || typeof raw === "number"
        ? `jamie:meeting:${raw}` : null;
    })();
    const { data: logRow } = await adminClient
      .from("webhook_payload_log")
      .insert({ source: "jamie_webhook", external_source_id: logExternalId, payload })
      .select("id")
      .single();
    const webhookLogId = logRow?.id as string | undefined;

    const finalizeLog = async (status: number, meetingId?: string, error?: string) => {
      if (!webhookLogId) return;
      await adminClient
        .from("webhook_payload_log")
        .update({ http_status: status, meeting_id: meetingId ?? null, error: error ?? null })
        .eq("id", webhookLogId);
    };

    const meta = (payload.metadata as Record<string, unknown>) ?? {};
    const data = (payload.data as Record<string, unknown>) ?? {};

    const eventType = typeof meta.event === "string" ? meta.event : "";
    if (eventType && eventType !== "meeting.completed") {
      // Acknowledge unrecognized events without creating anything.
      await finalizeLog(200, undefined, `ignored_event:${eventType}`);
      return new Response(
        JSON.stringify({ ok: true, ignored_event: eventType }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const externalIdRaw = meta.id ?? meta.meetingId ?? meta.meeting_id;
    const externalId =
      typeof externalIdRaw === "string" || typeof externalIdRaw === "number"
        ? `jamie:meeting:${externalIdRaw}`
        : null;

    const segments = parseTranscriptArray(data.transcript);
    if (segments.length === 0) {
      // No transcript = nothing to ingest. Acknowledge so Jamie doesn't retry.
      console.warn("[jamie-webhook] empty transcript", { externalId });
      await finalizeLog(200, undefined, "empty_transcript");
      return new Response(
        JSON.stringify({ ok: true, warning: "empty transcript, nothing ingested" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Diagnostic: log the first segment's keys so we can validate field
    // names against real Jamie payloads. Once stable, this can be removed.
    console.log(
      "[jamie-webhook] first segment keys:",
      JSON.stringify(Object.keys(((data.transcript as unknown[])?.[0] ?? {}) as Record<string, unknown>))
    );

    const formattedTranscript = formatTranscript(segments);
    const attendees = uniqueSpeakers(segments);
    const title = deriveTitle(payload);
    const startTime = deriveStartTimeISO(payload);

    // ----- Merge with calendar_sync row if present -----
    //
    // The two ingestion pipelines (Power Automate → calendar-sync, Jamie
    // → jamie-webhook) produce separate rows for the same real meeting:
    // calendar uses external_source_id="outlook:event:...", jamie uses
    // "jamie:meeting:...". We merge by:
    //   1. Idempotency: existing row with this jamie_external_source_id
    //      already → return as duplicate.
    //   2. Find a candidate calendar_sync row for the same user with
    //      start_time within ±20 min of Jamie's, and no jamie_external
    //      _source_id yet. If exactly one match, UPDATE it with Jamie's
    //      transcript + attendees + title (only if calendar's was the
    //      placeholder "Untitled meeting") + jamie_external_source_id.
    //   3. If 0 or 2+ candidates, fall through to INSERT a fresh row
    //      (the current behavior). 2+ is conservative — refuse to guess
    //      which calendar row this is, leave the duplicate to be merged
    //      manually.
    let meetingId: string | null = null;
    let mergedFromCalendar = false;

    // Step 1: idempotency
    const { data: alreadyExists } = await adminClient
      .from("meetings")
      .select("id")
      .eq("user_id", userId)
      .eq("jamie_external_source_id", externalId)
      .maybeSingle();
    if (alreadyExists) {
      console.log("[jamie-webhook] duplicate (jamie_external_source_id), ignoring", { externalId });
      await finalizeLog(200, undefined, "duplicate");
      return new Response(
        JSON.stringify({ ok: true, duplicate: true, external_id: externalId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: candidate calendar_sync row
    if (startTime) {
      const start = new Date(startTime);
      const lo = new Date(start.getTime() - 20 * 60 * 1000).toISOString();
      const hi = new Date(start.getTime() + 20 * 60 * 1000).toISOString();
      const { data: candidates } = await adminClient
        .from("meetings")
        .select("id, title, attendees, start_time")
        .eq("user_id", userId)
        .eq("source", "calendar_sync")
        .is("jamie_external_source_id", null)
        .gte("start_time", lo)
        .lte("start_time", hi);

      if (candidates && candidates.length === 1) {
        const cand = candidates[0] as { id: string; title: string | null; attendees: string[] | null };
        // Merge attendees: calendar's emails + Jamie's speaker names. Both
        // signals are useful — keep them all, dedup'd.
        const mergedAttendees = Array.from(
          new Set([...(cand.attendees ?? []), ...attendees].filter(Boolean))
        );
        // Title: prefer the more specific one. Calendar's "Untitled
        // meeting" placeholder loses to Jamie's derived title.
        const finalTitle =
          cand.title && cand.title !== "Untitled meeting" ? cand.title : title;

        const { error: updateErr } = await adminClient
          .from("meetings")
          .update({
            title: finalTitle,
            attendees: mergedAttendees,
            transcript: formattedTranscript,
            jamie_external_source_id: externalId,
            // Don't overwrite source/external_source_id — keep the calendar
            // lineage as the row's primary identity.
          })
          .eq("id", cand.id);

        if (!updateErr) {
          meetingId = cand.id;
          mergedFromCalendar = true;
          console.log("[jamie-webhook] merged into calendar row", { calendarId: cand.id, externalId });
        } else {
          console.warn("[jamie-webhook] calendar merge failed, falling through to insert:", updateErr);
        }
      } else if (candidates && candidates.length > 1) {
        console.log("[jamie-webhook] multiple calendar candidates in window, refusing to guess; inserting fresh row", {
          externalId,
          candidateCount: candidates.length,
        });
      }
    }

    // Step 3: insert fresh row if no merge happened
    if (!meetingId) {
      const insertPayload: Record<string, unknown> = {
        user_id: userId,
        title,
        start_time: startTime,
        attendees,
        transcript: formattedTranscript,
        source: "jamie_webhook",
        import_mode: "active",
        external_source_id: externalId,
        jamie_external_source_id: externalId,
      };

      const { data: inserted, error: insertErr } = await adminClient
        .from("meetings")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insertErr) {
        // Unique violation could mean a race with idempotency check OR
        // pre-merge-migration row using external_source_id. Acknowledge.
        const code = (insertErr as { code?: string }).code;
        if (code === "23505") {
          console.log("[jamie-webhook] duplicate (unique violation), ignoring", { externalId });
          await finalizeLog(200, undefined, "duplicate");
          return new Response(
            JSON.stringify({ ok: true, duplicate: true, external_id: externalId }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        console.error("[jamie-webhook] insert failed:", insertErr);
        await finalizeLog(500, undefined, insertErr.message);
        return new Response(
          JSON.stringify({
            error: "Failed to insert meeting",
            detail: insertErr.message,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      meetingId = (inserted as { id: string }).id;
    }

    // Type guard — meetingId is non-null after step 2 (merge) or step 3
    // (insert). Both branches either assign or return, so this is the
    // post-condition; the check is for TypeScript narrowing + defense.
    if (!meetingId) {
      await finalizeLog(500, undefined, "meetingId not resolved");
      return new Response(
        JSON.stringify({ error: "Internal: meetingId unresolved" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ----- Resolve attendees → people + meeting_attendees -----
    try {
      const personIds = await resolveAttendees(adminClient, userId, attendees);
      if (personIds.length > 0) {
        const junctionRows = personIds.map((pid: string) => ({
          meeting_id: meetingId,
          person_id: pid,
        }));
        await adminClient.from("meeting_attendees").upsert(junctionRows, {
          onConflict: "meeting_id,person_id",
          ignoreDuplicates: true,
        });
      }
    } catch (linkErr) {
      console.warn("[jamie-webhook] identity resolution warning:", linkErr);
    }

    // ----- Invoke parser (fire-and-forget via waitUntil) -----
    // Kick off the parser in the background so the parse duration is
    // independent of this webhook's response time. Transcript size must
    // NOT constrain ingestion. EdgeRuntime.waitUntil keeps the isolate
    // alive after the Response is returned so the parse fetch completes.
    // If the parser fails, retry-unprocessed will catch it later.
    const parseTask = fetch(
      `${supabaseUrl}/functions/v1/ai-parse-transcript`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          meeting_id: meetingId,
          transcript: formattedTranscript,
        }),
      }
    )
      .then(async (parseRes) => {
        if (parseRes.ok) {
          console.log("[jamie-webhook] parser succeeded for", meetingId);
        } else {
          const detail = await parseRes.text().catch(() => "");
          console.error("[jamie-webhook] parser failed:", parseRes.status, detail.substring(0, 500));
        }
      })
      .catch((err) => {
        console.error("[jamie-webhook] parser error:", err);
      });

    // deno-lint-ignore no-explicit-any
    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (edgeRuntime && typeof edgeRuntime.waitUntil === "function") {
      edgeRuntime.waitUntil(parseTask);
    }

    await finalizeLog(200, meetingId);
    return new Response(
      JSON.stringify({
        ok: true,
        meeting_id: meetingId,
        external_id: externalId,
        title,
        attendees,
        segments_count: segments.length,
        parse_status: "dispatched",
        merged_from_calendar: mergedFromCalendar,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[jamie-webhook] uncaught error:", err);
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    // Best-effort log finalization (finalizeLog may not be defined if error was early)
    try { await finalizeLog(500, undefined, message); } catch { /* ignore */ }
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: message, stack }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
