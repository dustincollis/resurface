// ai-goal-chat: conversational AI for goals that can create milestones.
//
// The user describes what they want to accomplish and the AI proposes
// milestones with appropriate condition types and linked entities.
// The AI can also create milestones directly via tool use.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === serviceRoleKey;
    if (!user && !isServiceRole) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user?.id ?? Deno.env.get("RESURFACE_DEFAULT_USER_ID")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const goalId = body.goal_id as string;
    const userMessage = body.message as string;

    if (!goalId || !userMessage?.trim()) {
      return new Response(
        JSON.stringify({ error: "goal_id and message required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Gather context
    const { data: goal } = await admin
      .from("goals")
      .select("*")
      .eq("id", goalId)
      .eq("user_id", userId)
      .single();

    if (!goal) {
      return new Response(
        JSON.stringify({ error: "Goal not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Existing milestones
    const { data: milestones } = await admin
      .from("goal_tasks")
      .select("*")
      .eq("goal_id", goalId)
      .order("sort_order");

    // Available pursuits (for linking)
    const { data: pursuits } = await admin
      .from("pursuits")
      .select("id, name, status, company")
      .eq("user_id", userId)
      .order("name");

    // Available people (for meeting milestones)
    const { data: people } = await admin
      .from("people")
      .select("id, name, email, company_id, companies(name)")
      .eq("user_id", userId)
      .order("name")
      .limit(100);

    // Available companies
    const { data: companies } = await admin
      .from("companies")
      .select("id, name")
      .eq("user_id", userId)
      .order("name");

    // Chat history (using chat_messages with scope_type='goal')
    const { data: history } = await admin
      .from("chat_messages")
      .select("role, content")
      .eq("user_id", userId)
      .eq("scope_type", "goal")
      .eq("scope_id", goalId)
      .order("created_at", { ascending: true })
      .limit(20);

    const threadHistory: ChatMessage[] = (history ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
    }));

    // Persist user message
    await admin.from("chat_messages").insert({
      user_id: userId,
      role: "user",
      content: userMessage.trim(),
      scope_type: "goal",
      scope_id: goalId,
      actions_taken: [],
    });

    // Build system prompt
    const milestoneList = (milestones ?? []).length > 0
      ? (milestones ?? []).map((m, i) =>
          `${i + 1}. "${m.title}" [${m.condition_type}] ${m.condition_met ? '✓' : '○'} ${m.evidence_text ?? ''}`
        ).join("\n")
      : "(none yet)";

    const pursuitList = (pursuits ?? []).length > 0
      ? (pursuits ?? []).map((p) => `- ${p.name} (${p.status})${p.company ? ` [${p.company}]` : ''} id:${p.id}`).join("\n")
      : "(none)";

    const companyList = (companies ?? []).length > 0
      ? (companies ?? []).map((c) => `- ${c.name} id:${c.id}`).join("\n")
      : "(none)";

    const peopleList = (people ?? []).slice(0, 50).length > 0
      ? (people ?? []).slice(0, 50).map((p) => {
          const co = (p.companies as { name: string } | null)?.name;
          return `- ${p.name}${co ? ` (${co})` : ''}${p.email ? ` <${p.email}>` : ''} id:${p.id}`;
        }).join("\n")
      : "(none)";

    const systemPrompt = `You are a goal planning assistant for Resurface, a relationship and motion memory system for a sales/account executive.

## Current Goal
Name: "${goal.name}"
Description: ${goal.description ?? "(none)"}
Status: ${goal.status}

## Existing Milestones
${milestoneList}

## Available Pursuits (for linking)
${pursuitList}

## Available Companies
${companyList}

## Key People
${peopleList}

## Your Job
Help the user plan milestones for this goal. When they describe what they want to accomplish, propose specific milestones with the right tracking type:

- **manual**: User marks it done themselves. Use when the milestone is subjective or can't be auto-tracked.
- **pursuit**: Auto-completes when a linked pursuit reaches a target status (e.g., "won"). Use for deal outcomes.
- **item**: Auto-completes when a linked task reaches "done". Use for specific deliverables.
- **commitment**: Auto-completes when a linked commitment is "met". Use for promises.
- **meeting**: Auto-completes when a meeting matching criteria exists (with specific people, about specific topics).
- **count**: Auto-completes when a count threshold is met (e.g., "3 pursuits won").

When proposing milestones, format each one as:

**Milestone: [title]**
Type: [manual/pursuit/item/commitment/meeting/count]
Link: [entity name and id if applicable]
Target: [target status or criteria]
Why: [one line explaining what this proves]

After proposing, ask the user if they want to create them. When they confirm, output a JSON block that the frontend will parse:

\`\`\`milestones
[
  { "title": "...", "condition_type": "manual|pursuit|item|commitment|meeting|count", "linked_entity_id": "uuid-or-null", "target_status": "status-or-null", "condition_config": {} }
]
\`\`\`

Be concise. Don't over-explain. Propose 3-7 milestones that form a coherent path to the goal.`;

    // Build messages
    const messages = [
      ...threadHistory.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userMessage.trim() },
    ];

    // Call Claude
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: systemPrompt,
        messages,
      }),
    });

    if (!aiRes.ok) {
      const detail = await aiRes.text();
      console.error("[ai-goal-chat] Claude error:", aiRes.status, detail.substring(0, 500));
      return new Response(
        JSON.stringify({ error: "AI call failed", detail: detail.substring(0, 200) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiBody = await aiRes.json();
    const assistantContent = aiBody.content?.[0]?.text ?? "I couldn't generate a response.";

    // Check if the response contains a milestones JSON block
    let createdMilestones: unknown[] = [];
    const milestoneMatch = assistantContent.match(/```milestones\n([\s\S]*?)\n```/);
    if (milestoneMatch) {
      try {
        const parsed = JSON.parse(milestoneMatch[1]);
        if (Array.isArray(parsed)) {
          const maxOrder = (milestones ?? []).reduce((m: number, t: { sort_order: number }) => Math.max(m, t.sort_order), -1);
          const rows = parsed.map((m: Record<string, unknown>, i: number) => ({
            goal_id: goalId,
            title: m.title as string,
            sort_order: maxOrder + 1 + i,
            condition_type: m.condition_type ?? "manual",
            linked_entity_id: m.linked_entity_id ?? null,
            target_status: m.target_status ?? null,
            condition_config: m.condition_config ?? {},
          }));

          const { data: inserted, error: insertErr } = await admin
            .from("goal_tasks")
            .insert(rows)
            .select("id, title, condition_type");

          if (!insertErr && inserted) {
            createdMilestones = inserted;
          } else if (insertErr) {
            console.error("[ai-goal-chat] milestone insert error:", insertErr);
          }
        }
      } catch (parseErr) {
        console.warn("[ai-goal-chat] couldn't parse milestones block:", parseErr);
      }
    }

    // Persist assistant message
    const { data: savedMsg } = await admin
      .from("chat_messages")
      .insert({
        user_id: userId,
        role: "assistant",
        content: assistantContent,
        scope_type: "goal",
        scope_id: goalId,
        actions_taken: createdMilestones.length > 0
          ? [{ type: "milestones_created", count: createdMilestones.length }]
          : [],
      })
      .select()
      .single();

    return new Response(
      JSON.stringify({
        ok: true,
        message: savedMsg,
        milestones_created: createdMilestones,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[ai-goal-chat] error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
