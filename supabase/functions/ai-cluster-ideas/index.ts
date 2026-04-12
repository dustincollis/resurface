import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    // Auth — accept user JWT (browser) or service role (scripts)
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
    const dryRun = body.dry_run === true;

    // Fetch all ideas
    const { data: ideas, error: fetchErr } = await adminClient
      .from("ideas")
      .select("id, title, description, company_name, category, originated_by")
      .order("created_at", { ascending: true });

    if (fetchErr) throw fetchErr;
    if (!ideas || ideas.length < 3) {
      return new Response(
        JSON.stringify({ error: "Not enough ideas to cluster", count: ideas?.length ?? 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build prompt
    const ideaLines = ideas.map((idea, i) => {
      const co = idea.company_name || "general";
      const cat = idea.category || "other";
      const desc = (idea.description || "").substring(0, 120);
      return `${i}: [${cat}] (${co}) ${idea.title} — ${desc}`;
    });

    const prompt = `You are analyzing a corpus of ${ideas.length} strategic ideas extracted from 6+ months of sales meetings for a senior GTM leader at EPAM (a technology consultancy). Your job is to identify natural clusters — groups of ideas that address the same theme, strategy, or opportunity, even if they appeared in different meetings about different clients.

Here are the ideas (format: index: [category] (company) title — description):

${ideaLines.join("\n")}

Group these into clusters. Rules:
- Each cluster should have 2+ ideas that share a common strategic theme
- Ideas that don't fit any cluster can go in an "Unclustered" group
- Aim for 8-20 clusters (not too granular, not too broad)
- Cluster labels should be concise (3-8 words) and action-oriented where possible
- The same idea can only appear in one cluster
- Focus on strategic similarity, not just same company or same category

Return ONLY valid JSON (no markdown, no code fences):
{
  "clusters": [
    {
      "label": "string — concise cluster name",
      "description": "string — 1 sentence explaining what unifies these ideas",
      "idea_indices": [0, 3, 7]
    }
  ]
}`;

    // Call Claude
    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        temperature: 0.2,
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

    const parsed = JSON.parse(rawContent.trim());
    const clusters = parsed.clusters ?? [];

    if (dryRun) {
      return new Response(
        JSON.stringify({
          dry_run: true,
          total_ideas: ideas.length,
          clusters: clusters.map((c: { label: string; description?: string; idea_indices: number[] }) => ({
            label: c.label,
            description: c.description,
            count: c.idea_indices.length,
            ideas: c.idea_indices.map((idx: number) => ideas[idx]?.title ?? `[invalid index ${idx}]`),
          })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Write cluster assignments
    const assignedIndices = new Set<number>();
    let updated = 0;

    for (const cluster of clusters) {
      const clusterId = crypto.randomUUID();
      const label = cluster.label;
      const indices: number[] = cluster.idea_indices ?? [];

      for (const idx of indices) {
        if (idx < 0 || idx >= ideas.length) continue;
        assignedIndices.add(idx);
        const { error: updateErr } = await adminClient
          .from("ideas")
          .update({ cluster_id: clusterId, cluster_label: label })
          .eq("id", ideas[idx].id);
        if (!updateErr) updated++;
      }
    }

    // Clear cluster on unclustered ideas (in case of re-run)
    let cleared = 0;
    for (let i = 0; i < ideas.length; i++) {
      if (!assignedIndices.has(i)) {
        const { error: clearErr } = await adminClient
          .from("ideas")
          .update({ cluster_id: null, cluster_label: null })
          .eq("id", ideas[i].id);
        if (!clearErr) cleared++;
      }
    }

    return new Response(
      JSON.stringify({
        total_ideas: ideas.length,
        clusters_found: clusters.length,
        ideas_clustered: updated,
        ideas_unclustered: cleared,
        clusters: clusters.map((c: { label: string; description?: string; idea_indices: number[] }) => ({
          label: c.label,
          description: c.description,
          count: c.idea_indices.length,
        })),
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
