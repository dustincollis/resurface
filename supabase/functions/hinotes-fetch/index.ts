// Resolves a HiNotes share URL into a structured payload that the rest of
// the Resurface ingest pipeline can consume directly.
//
// Discovered endpoint (undocumented, public, no auth):
//   GET https://hinotes.hidock.com/v1/share/note?shortId=<token>
// Returns an XML envelope:
//   <Result>
//     <error>0</error>
//     <message>success</message>
//     <data>
//       <note>
//         <title>...</title>
//         <createTime>1775739391000</createTime>   (millis since epoch)
//         <conciseSummary>...</conciseSummary>
//         <markdown>...</markdown>                  (pre-structured outline)
//         <duration>779688</duration>
//         <tags>foo,bar</tags>
//         ...
//       </note>
//       <speakers><speakers>...</speakers></speakers>
//     </data>
//   </Result>
//
// The `markdown` field is rich enough to feed straight into the existing
// transcript parser — no need to also fetch the verbatim transcript.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

const HINOTES_HOST = "https://hinotes.hidock.com";

// Accepts either:
//   https://hinotes.hidock.com/s/76QihyKuRlC
//   https://hinotes.hidock.com/v/76QihyKuRlC
//   76QihyKuRlC                  (raw shortId)
function extractShortId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/hinotes\.hidock\.com\/[sv]\/([A-Za-z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  // Bare token: 6–20 chars, base62-ish
  if (/^[A-Za-z0-9_-]{6,20}$/.test(trimmed)) return trimmed;
  return null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Tiny tag extractor: pulls the inner text of the first occurrence of <tag>.
// Defensive — returns null on missing or malformed tags. We avoid a full XML
// parser dep because the response shape is fixed and shallow.
function pickTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  if (!match) return null;
  return decodeXmlEntities(match[1]).trim();
}

// Pull every occurrence of a tag (used for the per-utterance transcription list).
function pickAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(decodeXmlEntities(m[1]));
  }
  return out;
}

// Format millis offset into [mm:ss] for the transcript header.
function formatOffset(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// Parse the /v1/share/transcription/list response into a single readable
// transcript string. Each <data> block has speaker + sentence + beginTime.
function parseTranscriptionXml(xml: string): string {
  // Each utterance is wrapped in a <data> block at the top level of <Result>.
  // We split on </data> to get the blocks (the regex approach in pickAllTags
  // doesn't work because <data> contains nested tags).
  const blocks = xml.split(/<\/data>/);
  const lines: string[] = [];
  for (const block of blocks) {
    const speaker = pickTag(block, "speaker");
    const sentence = pickTag(block, "sentence");
    const beginTimeStr = pickTag(block, "beginTime");
    if (!sentence) continue;
    const beginTime = beginTimeStr ? Number(beginTimeStr) : null;
    const stamp = beginTime != null && !isNaN(beginTime) ? `[${formatOffset(beginTime)}] ` : "";
    const who = speaker ? `${speaker}: ` : "";
    lines.push(`${stamp}${who}${sentence}`);
  }
  return lines.join("\n");
}

void pickAllTags; // currently unused; kept for future fields

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth: same pattern as the other AI functions — verify the user JWT.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await adminClient.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const input: string | undefined = body.url ?? body.shortId;
    if (!input) {
      return new Response(
        JSON.stringify({ error: "Missing 'url' or 'shortId' in request body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const shortId = extractShortId(input);
    if (!shortId) {
      return new Response(
        JSON.stringify({ error: "Could not extract a HiNotes shortId from the input" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const fetchHeaders = {
      "Accept": "*/*",
      "User-Agent": "Resurface-HiNotes-Resolver/1.0",
    } as const;

    // Fetch the note metadata (title, summary, markdown outline) and the
    // verbatim transcription list (per-utterance dialogue) in parallel.
    const [noteRes, transcriptionRes] = await Promise.all([
      fetch(
        `${HINOTES_HOST}/v1/share/note?shortId=${encodeURIComponent(shortId)}`,
        { headers: fetchHeaders }
      ),
      fetch(
        `${HINOTES_HOST}/v1/share/transcription/list?shortId=${encodeURIComponent(shortId)}`,
        { headers: fetchHeaders }
      ),
    ]);

    if (!noteRes.ok) {
      const errText = await noteRes.text();
      return new Response(
        JSON.stringify({
          error: "HiNotes upstream returned an error",
          status: noteRes.status,
          detail: errText.substring(0, 500),
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const xml = await noteRes.text();

    // Verbatim transcription is best-effort: if it fails we still return the
    // markdown so the user gets something rather than nothing.
    let verbatimTranscript: string | null = null;
    if (transcriptionRes.ok) {
      const transcriptionXml = await transcriptionRes.text();
      const tErr = pickTag(transcriptionXml, "error");
      if (!tErr || tErr === "0") {
        const formatted = parseTranscriptionXml(transcriptionXml);
        if (formatted.length > 0) {
          verbatimTranscript = formatted;
        }
      }
    }

    // The XML envelope wraps the success/error code. Surface upstream errors.
    const upstreamError = pickTag(xml, "error");
    if (upstreamError && upstreamError !== "0") {
      const upstreamMessage = pickTag(xml, "message") ?? "Unknown HiNotes error";
      return new Response(
        JSON.stringify({
          error: "HiNotes returned an error code",
          code: upstreamError,
          message: upstreamMessage,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const title = pickTag(xml, "title");
    const markdown = pickTag(xml, "markdown");
    const conciseSummary = pickTag(xml, "conciseSummary");
    const createTimeStr = pickTag(xml, "createTime");
    const duration = pickTag(xml, "duration");
    const language = pickTag(xml, "language");
    const tagsStr = pickTag(xml, "tags");
    const memberCount = pickTag(xml, "memberCount");

    const createTime = createTimeStr ? Number(createTimeStr) : null;
    const startTimeISO =
      createTime && !isNaN(createTime) ? new Date(createTime).toISOString() : null;

    // Prefer the verbatim transcript as the content we feed downstream — it
    // gives our parser the raw text needed to extract real evidence quotes
    // and detect commitment strength. Fall back to the markdown outline if
    // the transcription endpoint failed for some reason.
    const content = verbatimTranscript ?? markdown;
    if (!content) {
      return new Response(
        JSON.stringify({
          error: "HiNotes response had no transcript or markdown content to ingest",
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        shortId,
        title: title ?? `HiNotes ${shortId}`,
        content,
        content_source: verbatimTranscript ? "verbatim_transcript" : "markdown_outline",
        markdown,
        concise_summary: conciseSummary,
        start_time: startTimeISO,
        duration_ms: duration ? Number(duration) : null,
        language,
        tags: tagsStr ? tagsStr.split(",").map((t) => t.trim()).filter(Boolean) : [],
        member_count: memberCount ? Number(memberCount) : null,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
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
