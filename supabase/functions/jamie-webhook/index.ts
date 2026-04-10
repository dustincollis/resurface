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

    const meta = (payload.metadata as Record<string, unknown>) ?? {};
    const data = (payload.data as Record<string, unknown>) ?? {};

    const eventType = typeof meta.event === "string" ? meta.event : "";
    if (eventType && eventType !== "meeting.completed") {
      // Acknowledge unrecognized events without creating anything.
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

    // ----- Insert meeting row -----
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const insertPayload: Record<string, unknown> = {
      user_id: userId,
      title,
      start_time: startTime,
      attendees,
      transcript: formattedTranscript,
      source: "jamie_webhook",
      import_mode: "active",
      external_source_id: externalId,
    };

    const { data: inserted, error: insertErr } = await adminClient
      .from("meetings")
      .insert(insertPayload)
      .select("id")
      .single();

    if (insertErr) {
      // Unique violation on (user_id, external_source_id) means we've
      // already processed this meeting. Acknowledge idempotently.
      const code = (insertErr as { code?: string }).code;
      if (code === "23505") {
        console.log("[jamie-webhook] duplicate, ignoring", { externalId });
        return new Response(
          JSON.stringify({ ok: true, duplicate: true, external_id: externalId }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.error("[jamie-webhook] insert failed:", insertErr);
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

    const meetingId = (inserted as { id: string }).id;

    // ----- Invoke parser — fire and forget -----
    // The previous approach awaited the parser response, which was failing
    // silently (timeout, network flakiness between edge functions, Claude
    // overload). The webhook doesn't need the parse result — the meeting
    // row is already created. So we fire the fetch and return immediately.
    //
    // If the parse fails, the compute-staleness cron job will pick up
    // meetings with processed_at IS NULL and re-trigger parsing as a
    // safety net.
    fetch(`${supabaseUrl}/functions/v1/ai-parse-transcript`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        meeting_id: meetingId,
        transcript: formattedTranscript,
      }),
    }).then((res) => {
      if (!res.ok) {
        res.text().then((detail) => {
          console.error("[jamie-webhook] parser invocation failed:", res.status, detail.substring(0, 500));
        });
      } else {
        console.log("[jamie-webhook] parser invocation succeeded for", meetingId);
      }
    }).catch((err) => {
      console.error("[jamie-webhook] parser fetch error:", err);
    });

    return new Response(
      JSON.stringify({
        ok: true,
        meeting_id: meetingId,
        external_id: externalId,
        title,
        attendees,
        segments_count: segments.length,
        parse_status: "triggered_async",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[jamie-webhook] uncaught error:", err);
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: message, stack }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
