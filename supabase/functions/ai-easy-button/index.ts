import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

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

    const { user_context } = await req.json().catch(() => ({}));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
    } = await adminClient.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch active, non-snoozed tasks
    const now = new Date().toISOString();
    const { data: items } = await adminClient
      .from("items")
      .select(
        "id, title, description, status, stream_id, next_action, due_date, stakes, resistance, last_touched_at, streams(name)"
      )
      .eq("user_id", user.id)
      .not("status", "in", '("done","dropped")')
      .or(`snoozed_until.is.null,snoozed_until.lte.${now}`)
      .limit(100);

    if (!items || items.length === 0) {
      return new Response(
        JSON.stringify({ error: "No active tasks to choose from" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Score each task by "ease": low resistance, has next_action, low stakes-of-failure
    type ScoredItem = (typeof items)[number] & { easeScore: number };
    const scored: ScoredItem[] = items.map((item) => {
      let score = 0;
      // Low resistance is the strongest signal of "easy"
      const resistance = item.resistance ?? 3;
      score += (6 - resistance) * 20; // resistance 1 → 100, resistance 5 → 20
      // Having a clear next action means we know exactly what to do
      if (item.next_action && item.next_action.trim().length > 0) score += 30;
      // Lower stakes = lower pressure
      const stakes = item.stakes ?? 3;
      score += (6 - stakes) * 5;
      // Slight preference for things that haven't been touched in a while
      // (so easy wins clear out)
      const daysSinceTouch =
        (Date.now() - new Date(item.last_touched_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceTouch >= 1) score += Math.min(daysSinceTouch * 2, 20);
      return { ...item, easeScore: score };
    });

    scored.sort((a, b) => b.easeScore - a.easeScore);

    // Pick from the top 3 randomly so the user doesn't always get the same one
    const topPicks = scored.slice(0, Math.min(3, scored.length));
    const picked = topPicks[Math.floor(Math.random() * topPicks.length)];

    // Ask Claude for guidance on how to tackle it quickly
    const userContextBlock =
      typeof user_context === "string" && user_context.length > 0
        ? user_context + "\n\n"
        : "";

    const prompt = `${userContextBlock}You're helping someone pick an easy task to knock out quickly. They clicked an "Easy Button" — give them a low-pressure, encouraging suggestion for how to tackle this specific task in under 30 minutes.

Task details:
- Title: ${picked.title}
- Stream: ${(picked.streams as { name: string } | null)?.name ?? "no stream"}
- Status: ${picked.status}
- Next step: ${picked.next_action ?? "(none set)"}
- Description: ${picked.description ?? "(none)"}
- Resistance (1=easy, 5=dread): ${picked.resistance ?? "unset"}
- Stakes (1=low, 5=high): ${picked.stakes ?? "unset"}
${picked.due_date ? `- Due: ${picked.due_date}` : ""}

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "guidance": "a short, encouraging 2-4 sentence suggestion on how to start and finish this in under 30 minutes. Be specific about the first physical action. No fluff, no asterisks, no headers."
}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
        temperature: 0.6,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    let guidance =
      "No specific guidance — just open the task and take the first concrete step. Aim to finish in one sitting.";

    if (response.ok) {
      const aiResponse = await response.json();
      const rawContent = aiResponse.content?.[0]?.text ?? "";
      let cleanContent = rawContent.trim();
      if (cleanContent.startsWith("```")) {
        cleanContent = cleanContent
          .replace(/^```(?:json)?\s*\n?/, "")
          .replace(/\n?```\s*$/, "");
      }
      try {
        const parsed = JSON.parse(cleanContent);
        if (typeof parsed.guidance === "string") {
          guidance = parsed.guidance;
        }
      } catch {
        // fallback already set
      }
    }

    return new Response(
      JSON.stringify({
        task: {
          id: picked.id,
          title: picked.title,
          description: picked.description,
          stream_name: (picked.streams as { name: string } | null)?.name ?? null,
          next_action: picked.next_action,
          due_date: picked.due_date,
          resistance: picked.resistance,
          stakes: picked.stakes,
        },
        guidance,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
