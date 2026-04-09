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

// Tiny tag extractor: pulls the inner text of the first occurrence of <tag>.
// Defensive — returns null on missing or malformed tags. We avoid a full XML
// parser dep because the response shape is fixed and shallow.
function pickTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  if (!match) return null;
  // Decode the handful of XML entities HiNotes actually uses.
  return match[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

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

    const upstream = await fetch(
      `${HINOTES_HOST}/v1/share/note?shortId=${encodeURIComponent(shortId)}`,
      {
        headers: {
          "Accept": "*/*",
          "User-Agent": "Resurface-HiNotes-Resolver/1.0",
        },
      }
    );

    if (!upstream.ok) {
      const errText = await upstream.text();
      return new Response(
        JSON.stringify({
          error: "HiNotes upstream returned an error",
          status: upstream.status,
          detail: errText.substring(0, 500),
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const xml = await upstream.text();

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

    if (!markdown) {
      return new Response(
        JSON.stringify({
          error: "HiNotes response was missing the 'markdown' field — content cannot be ingested",
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
