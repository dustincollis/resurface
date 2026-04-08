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

    const { item_id, user_context } = await req.json();
    if (!item_id) {
      return new Response(JSON.stringify({ error: "item_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify user from JWT
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

    // Fetch the item with its stream
    const { data: item, error: itemError } = await adminClient
      .from("items")
      .select("*, streams(name, field_templates)")
      .eq("id", item_id)
      .eq("user_id", user.id)
      .single();

    if (itemError || !item) {
      return new Response(JSON.stringify({ error: "Item not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const streamName =
      (item.streams as { name: string } | null)?.name ?? "no stream";
    const customFieldsText =
      item.custom_fields && Object.keys(item.custom_fields).length > 0
        ? `\nCustom fields: ${JSON.stringify(item.custom_fields)}`
        : "";

    // Today's date for relative due date suggestions
    const today = new Date().toISOString().split("T")[0];

    // Call Claude
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        temperature: 0.4,
        messages: [
          {
            role: "user",
            content: `You are breaking down a work item into concrete sub-tasks. The user wants 3-7 actionable steps that, when completed in sequence, will accomplish the parent item.
${typeof user_context === "string" && user_context.length > 0 ? "\n" + user_context + "\n" : `\nToday's date: ${today}\n`}

Parent item:
- Title: "${item.title}"
- Description: "${item.description || "(no description)"}"
- Stream: ${streamName}
- Status: ${item.status}
- Next action: ${item.next_action || "(none)"}
- Due date: ${item.due_date || "(none)"}${customFieldsText}

Generate 3-7 sub-tasks that break down this work into concrete steps. Each sub-task should:
- Be specific and actionable (not vague)
- Be small enough to complete in one focused work session
- Have a clear outcome
- Be ordered logically (first task first)

For each sub-task, suggest:
- A short title (imperative form, e.g. "Draft proposal outline")
- A 1-2 sentence description
- A concrete next_action — the immediate first step
- A suggested_due_date in YYYY-MM-DD format ONLY if the parent has a due date or the sub-task has obvious time pressure. Distribute due dates across the parent's timeframe if applicable. Otherwise null.

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "sub_tasks": [
    {
      "title": "string",
      "description": "string",
      "next_action": "string",
      "suggested_due_date": "YYYY-MM-DD or null"
    }
  ]
}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", errText);
      return new Response(JSON.stringify({ error: "AI decompose failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await response.json();
    const rawContent = aiResponse.content?.[0]?.text ?? "";

    // Strip code fences if present
    let cleanContent = rawContent.trim();
    if (cleanContent.startsWith("```")) {
      cleanContent = cleanContent
        .replace(/^```(?:json)?\s*\n?/, "")
        .replace(/\n?```\s*$/, "");
    }

    let parsed: { sub_tasks?: unknown[] };
    try {
      parsed = JSON.parse(cleanContent);
    } catch (parseErr) {
      console.error("Failed to parse AI response:", parseErr, "Raw:", rawContent);
      return new Response(
        JSON.stringify({
          error: "Failed to parse AI response",
          raw: rawContent.substring(0, 500),
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        sub_tasks: parsed.sub_tasks ?? [],
        parent_stream_id: item.stream_id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
