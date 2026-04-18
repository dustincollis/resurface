import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import { recordAiCall } from "../_shared/telemetry.ts";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-7";

const SYSTEM_PROMPT = `You are preparing a pre-event briefing report for Dustin Collis, Head of Adobe Practice NA at EPAM Systems, who is attending Adobe Summit 2026 in Las Vegas (April 19-22).

Your job is to synthesize the provided source documents into a single, readable, plane-ready briefing narrative.

Rules:
- Write for someone reading on a phone on a plane — scannable, not dense walls of text
- Use clear markdown headers, bullet lists, and short paragraphs
- Prioritize: strategic objectives first, then day-by-day schedule, then people/accounts to engage, then messaging/talking points, then logistics
- Call out scheduling conflicts, open gaps, and priority tradeoffs explicitly — do not smooth them over
- Never fabricate details not in the source material; if something is unclear, say so
- Keep the tone direct and professional — this is a working document, not a press release
- Include a "Quick Reference" section at the end: key names, room numbers, meal times — the things you'd look up in a hurry

Structure:
1. Executive Summary (3-5 bullets: the most important things to know before landing)
2. Strategic Objectives
3. Scheduling (day-by-day — conflicts called out inline)
4. Key Meetings and Who to Watch For
5. Account Intelligence (top priority accounts with context on each)
6. Messaging and Talking Points (by offering/topic)
7. EPAM Team at Summit (roster with roles)
8. Open Gaps and Decisions Needed
9. Quick Reference (names, logistics, key contacts)`;

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SB_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      "";
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    const { bundle_id } = await req.json() as { bundle_id: string };
    if (!bundle_id) {
      return new Response(
        JSON.stringify({ error: "bundle_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify bundle ownership and readiness
    const { data: bundle, error: bundleError } = await adminClient
      .from("bundles")
      .select("id, name, status")
      .eq("id", bundle_id)
      .eq("user_id", userId)
      .single();

    if (bundleError || !bundle) {
      return new Response(JSON.stringify({ error: "Bundle not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (bundle.status !== "ready") {
      return new Response(
        JSON.stringify({ error: "Bundle must be ingested before generating a report" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load all source documents
    const { data: docs, error: docsError } = await adminClient
      .from("bundle_documents")
      .select("title, content_md, position")
      .eq("bundle_id", bundle_id)
      .order("position");

    if (docsError || !docs || docs.length === 0) {
      return new Response(
        JSON.stringify({ error: "No documents found in bundle" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load gaps for context
    const { data: gaps } = await adminClient
      .from("bundle_gaps")
      .select("content, state")
      .eq("bundle_id", bundle_id)
      .order("position");

    // Compose the context block
    const sourceContent = docs
      .map((d) => `# ${d.title}\n\n${d.content_md}`)
      .join("\n\n---\n\n");

    const gapsBlock =
      gaps && gaps.length > 0
        ? `\n\n---\n\n# Open Gaps and Unknowns\n\n${gaps.map((g) => `- ${g.content}`).join("\n")}`
        : "";

    const userContent = `Bundle name: ${bundle.name}

SOURCE DOCUMENTS:
${sourceContent}${gapsBlock}

Generate the plane-ready briefing report now.`;

    const t0 = Date.now();
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        thinking: { type: "adaptive" },
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: userContent,
          },
        ],
      }),
    });

    const latencyMs = Date.now() - t0;

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Claude API error ${res.status}: ${body}`);
    }

    const data = await res.json();

    // Extract text blocks (skip thinking blocks)
    const reportText = (data.content as { type: string; text?: string }[])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    // Store report (delete prior, insert new — one current report per bundle)
    await adminClient.from("bundle_reports").delete().eq("bundle_id", bundle_id);
    const { data: savedReport, error: saveError } = await adminClient
      .from("bundle_reports")
      .insert({
        bundle_id,
        content_md: reportText,
        model: MODEL,
        generated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (saveError) throw new Error(`Failed to save report: ${saveError.message}`);

    await recordAiCall(adminClient, {
      user_id: userId,
      function_name: "ai-bundle-report",
      model: MODEL,
      usage: data.usage,
      stop_reason: data.stop_reason,
      latency_ms: latencyMs,
      source_type: "bundle",
      source_id: bundle_id,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        report_id: savedReport?.id,
        content_md: reportText,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[ai-bundle-report] error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
