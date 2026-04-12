import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

// Processes one batch of un-triaged ideas.
// Caller loops until remaining == 0.
// Default batch size: 50 (safe for memory and Claude's output budget).

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SB_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const isServiceRole = token === serviceRoleKey;

    if (!isServiceRole) {
      const { data: { user } } = await adminClient.auth.getUser(token);
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(body.batch_size ?? 50, 10), 100);

    // Fetch next batch of un-triaged ideas
    const { data: ideas, error: fetchErr } = await adminClient
      .from("ideas")
      .select("id, title, description, company_name, category, originated_by, evidence_text")
      .is("quality", null)
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (fetchErr) throw fetchErr;

    // Get remaining count
    const { count: remaining } = await adminClient
      .from("ideas")
      .select("id", { count: "exact", head: true })
      .is("quality", null);

    if (!ideas || ideas.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, remaining: 0, done: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build compact prompt
    const ideaLines = ideas.map((idea, i) => {
      const orig = idea.originated_by || "unknown";
      const co = idea.company_name || "";
      const desc = (idea.description || "").substring(0, 100);
      return `${i}: [${orig}${co ? ` · ${co}` : ""}] ${idea.title}${desc ? ` — ${desc}` : ""}`;
    });

    const prompt = `You are triaging AI-extracted "ideas" from sales meeting transcripts for Dustin Collis, Head of Content Go-to-Market at EPAM. The parser over-extracted — many "ideas" are noise. Score each one as high, medium, or low signal.

**Dustin's role:**
- Leads content management, DAM, search GTM across Adobe, Sitecore, ContentStack, Contentful, Microsoft partnerships
- Sells to enterprise clients across industries (pharma, finance, retail, etc.)
- E-commerce is NOT his scope — a counterpart owns commerce platforms
- He cares about: strategic plays, packaged offerings, partner leverage, competitive positioning, GTM motions, pipeline generation
- He does NOT need: low-level technical implementation details, tactical operations, HR/learning methodologies, someone else's domain

**Scoring criteria:**

- **high** — Strategic, actionable, novel, in Dustin's scope. Either Dustin's own strategic thinking OR a named teammate proposing something that meaningfully advances his agenda. Has specificity (names a company, approach, or offering concretely). Would be worth re-reading in 3 months.

- **medium** — Relevant but not particularly novel or actionable. Restates common wisdom. Tactical adjustments to existing work. Useful context but not strategic gold. Named originator, somewhat specific.

- **low** — NOISE. Any of:
  - Attributed to "Speaker N", "Unknown", or missing originator (parser couldn't identify speaker)
  - Tactical/operational minutiae (e.g., "Sprint-based UAT", "Consolidate tech leads")
  - Out-of-Dustin's-scope (commerce platforms, HR learning design, low-level code architecture)
  - Generic platitudes ("Cross-train the team", "Better collaboration")
  - Restatement of obvious things ("Use case studies in presentations")
  - Vague with no specificity

**Be strict on low.** The goal is to aggressively cut noise so the remaining ideas are worth Dustin's attention. When in doubt between low and medium, go low. Better to lose a marginal idea than keep 500 marginal ideas.

Ideas to score:

${ideaLines.join("\n")}

Return ONLY valid JSON (no markdown, no code fences). Include every idea by index:
{
  "scores": [
    {"i": 0, "q": "high|medium|low", "r": "brief reason (under 15 words)"}
  ]
}`;

    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        temperature: 0.1,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      return new Response(
        JSON.stringify({ error: "Claude API error", detail: errText.substring(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResult = await aiResp.json();
    let rawContent = aiResult.content?.[0]?.text ?? "";
    if (rawContent.startsWith("```")) {
      rawContent = rawContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(rawContent.trim());
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid AI response", raw: rawContent.substring(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const scores = (parsed.scores ?? []) as Array<{ i: number; q: string; r: string }>;

    // Apply scores to DB
    let high = 0, medium = 0, low = 0;
    const triagedAt = new Date().toISOString();

    for (const score of scores) {
      if (score.i < 0 || score.i >= ideas.length) continue;
      const idea = ideas[score.i];
      const quality = ["high", "medium", "low"].includes(score.q) ? score.q : "medium";

      const updates: Record<string, unknown> = {
        quality,
        triage_reason: (score.r || "").substring(0, 300),
        triaged_at: triagedAt,
      };

      // Auto-dismiss low quality (only if currently surfaced — don't override explicit user action)
      if (quality === "low" && idea.title) {
        const { data: current } = await adminClient
          .from("ideas")
          .select("status")
          .eq("id", idea.id)
          .single();
        if (current?.status === "surfaced") {
          updates.status = "dismissed";
        }
      }

      await adminClient.from("ideas").update(updates).eq("id", idea.id);

      if (quality === "high") high++;
      else if (quality === "medium") medium++;
      else low++;
    }

    return new Response(
      JSON.stringify({
        processed: scores.length,
        high,
        medium,
        low,
        remaining: Math.max(0, (remaining ?? 0) - scores.length),
        done: false,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
