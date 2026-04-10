// ai-item-chat: per-item conversational AI thread.
//
// Each item has its own chat_messages thread (scope_type='item',
// scope_id=item_id). The function:
//   1. Verifies ownership
//   2. Gathers item context (same as ai-item-assist)
//   3. Reads existing thread history
//   4. Persists the new user message
//   5. Sends [system context] + [thread history] + [new user message] to Claude
//   6. Persists the assistant response
//   7. Returns the assistant message row
//
// Deploy with --no-verify-jwt. Dual auth (user JWT or service role).

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
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { item_id, message } = await req.json();
    if (!item_id || typeof message !== "string" || !message.trim()) {
      return new Response(
        JSON.stringify({ error: "item_id and non-empty message required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Auth (dual mode)
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isServiceRole = token === serviceRoleKey;

    let userId: string;
    if (isServiceRole) {
      const { data: row } = await adminClient
        .from("items")
        .select("user_id")
        .eq("id", item_id)
        .single();
      if (!row) {
        return new Response(JSON.stringify({ error: "Item not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = (row as { user_id: string }).user_id;
    } else {
      const { data: { user } } = await adminClient.auth.getUser(token);
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    // ============================================================
    // Gather item context (mirrors ai-item-assist)
    // ============================================================

    const { data: itemRow, error: itemErr } = await adminClient
      .from("items")
      .select("*, streams(name), source_meeting:meetings!source_meeting_id(id, title, transcript_summary, attendees, start_time)")
      .eq("id", item_id)
      .eq("user_id", userId)
      .single();

    if (itemErr || !itemRow) {
      return new Response(JSON.stringify({ error: "Item not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const item = itemRow as Record<string, unknown>;
    const sourceMeeting = item.source_meeting as
      | { id: string; title: string; transcript_summary: string | null; attendees: string[] | null; start_time: string | null }
      | null;

    const { data: profile } = await adminClient
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .single();
    const userDisplayName: string =
      ((profile?.display_name as string | undefined) ?? "").trim() || "the user";

    // Pursuits this item belongs to
    const { data: pursuitMembers } = await adminClient
      .from("pursuit_members")
      .select("pursuit_id")
      .eq("member_type", "item")
      .eq("member_id", item_id);
    const pursuitIds = (pursuitMembers ?? []).map((r) => r.pursuit_id as string);
    let pursuits: Array<{ id: string; name: string; description: string | null; company: string | null }> = [];
    if (pursuitIds.length > 0) {
      const { data: pursuitRows } = await adminClient
        .from("pursuits")
        .select("id, name, description, company")
        .in("id", pursuitIds);
      pursuits = (pursuitRows ?? []) as typeof pursuits;
    }

    // Sibling items in the same pursuits
    let siblingItems: Array<{ id: string; title: string; status: string }> = [];
    if (pursuitIds.length > 0) {
      const { data: siblingMemberRows } = await adminClient
        .from("pursuit_members")
        .select("member_id")
        .in("pursuit_id", pursuitIds)
        .eq("member_type", "item")
        .neq("member_id", item_id);
      const siblingIds = Array.from(
        new Set((siblingMemberRows ?? []).map((r) => r.member_id as string))
      ).slice(0, 10);
      if (siblingIds.length > 0) {
        const { data: siblingRows } = await adminClient
          .from("items")
          .select("id, title, status")
          .in("id", siblingIds);
        siblingItems = (siblingRows ?? []) as typeof siblingItems;
      }
    }

    // Related commitments from the same source meeting
    let relatedCommitments: Array<{ title: string; counterpart: string | null; do_by: string | null; status: string; direction: string }> = [];
    if (sourceMeeting?.id) {
      const { data: cRows } = await adminClient
        .from("commitments")
        .select("title, counterpart, do_by, status, direction")
        .eq("source_meeting_id", sourceMeeting.id)
        .eq("user_id", userId)
        .limit(10);
      relatedCommitments = (cRows ?? []) as typeof relatedCommitments;
    }

    // Build context block
    const ctx: string[] = [];
    ctx.push(`USER NAME: ${userDisplayName}`);
    ctx.push(`TODAY'S DATE: ${new Date().toISOString().split("T")[0]}`);
    ctx.push("");
    ctx.push("CURRENT ITEM (the thing the user is asking about):");
    ctx.push(`  Title: ${item.title}`);
    if (item.description) ctx.push(`  Description: ${item.description}`);
    if (item.next_action) ctx.push(`  Next action: ${item.next_action}`);
    if (item.due_date) ctx.push(`  Due: ${item.due_date}`);
    if (item.status) ctx.push(`  Status: ${item.status}`);
    if ((item.streams as { name?: string } | null)?.name) {
      ctx.push(`  Stream: ${(item.streams as { name: string }).name}`);
    }
    const company = (item.custom_fields as Record<string, unknown> | null)?.company;
    if (company) ctx.push(`  Company: ${company}`);
    ctx.push("");

    if (sourceMeeting) {
      ctx.push("SOURCE MEETING:");
      ctx.push(`  Title: ${sourceMeeting.title}`);
      if (sourceMeeting.start_time) {
        ctx.push(`  Date: ${new Date(sourceMeeting.start_time).toISOString().split("T")[0]}`);
      }
      if (sourceMeeting.attendees && sourceMeeting.attendees.length > 0) {
        ctx.push(`  Attendees: ${sourceMeeting.attendees.join(", ")}`);
      }
      if (sourceMeeting.transcript_summary) {
        ctx.push(`  Summary:`);
        ctx.push(sourceMeeting.transcript_summary.split("\n").map((l) => `    ${l}`).join("\n"));
      }
      ctx.push("");
    }

    if (pursuits.length > 0) {
      ctx.push("PURSUITS THIS ITEM BELONGS TO:");
      for (const p of pursuits) {
        const parts = [p.name];
        if (p.company) parts.push(`(${p.company})`);
        ctx.push(`  - ${parts.join(" ")}`);
        if (p.description) ctx.push(`    ${p.description}`);
      }
      ctx.push("");
    }

    if (siblingItems.length > 0) {
      ctx.push("OTHER ITEMS IN THE SAME PURSUITS:");
      for (const s of siblingItems) ctx.push(`  - [${s.status}] ${s.title}`);
      ctx.push("");
    }

    if (relatedCommitments.length > 0) {
      ctx.push("COMMITMENTS FROM THE SAME SOURCE MEETING:");
      for (const c of relatedCommitments) {
        const dir = c.direction === "incoming" ? "← " : "→ ";
        const who = c.counterpart ? ` ${dir}${c.counterpart}` : "";
        const when = c.do_by ? ` (do by ${c.do_by})` : "";
        ctx.push(`  - [${c.status}] ${c.title}${who}${when}`);
      }
      ctx.push("");
    }

    const systemPrompt = `You are an assistant helping ${userDisplayName} make progress on a specific task. You have access to the task itself, related context from meetings and pursuits, and the conversation history with the user.

Be specific and practical. Reference the actual people, dates, and details from the context — don't give generic advice. Use the user's name ("${userDisplayName}") only when natural; don't shoehorn it in.

When the user asks for a draft (email, agenda, memo), generate it ready-to-use with no placeholders. When they ask for advice, give concrete steps. When they ask "what's been said about this", cite the source meetings by name.

If something the user asks isn't answerable from the context, say so briefly rather than fabricating.

--- CONTEXT ---

${ctx.join("\n")}`;

    // ============================================================
    // Read existing thread history
    // ============================================================

    const { data: historyRows } = await adminClient
      .from("chat_messages")
      .select("role, content")
      .eq("user_id", userId)
      .eq("scope_type", "item")
      .eq("scope_id", item_id)
      .order("created_at", { ascending: true })
      .limit(40);

    const history: ChatMessage[] = (historyRows ?? []).map((r) => ({
      role: (r as { role: string }).role as "user" | "assistant",
      content: (r as { content: string }).content,
    }));

    // ============================================================
    // Persist the new user message FIRST (so it shows up immediately
    // even if Claude fails)
    // ============================================================

    const { data: userMsgRow, error: userMsgErr } = await adminClient
      .from("chat_messages")
      .insert({
        user_id: userId,
        role: "user",
        content: message.trim(),
        scope_type: "item",
        scope_id: item_id,
      })
      .select()
      .single();

    if (userMsgErr) {
      return new Response(
        JSON.stringify({ error: "Failed to persist user message", detail: userMsgErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ============================================================
    // Call Claude
    // ============================================================

    const messages: ChatMessage[] = [...history, { role: "user", content: message.trim() }];

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
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", errText);
      return new Response(
        JSON.stringify({
          error: "AI chat generation failed",
          detail: errText.substring(0, 500),
          user_message: userMsgRow,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiResponse = await response.json();
    const content = (aiResponse.content?.[0]?.text ?? "").trim();
    if (!content) {
      return new Response(
        JSON.stringify({ error: "AI returned empty content", user_message: userMsgRow }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ============================================================
    // Persist the assistant message
    // ============================================================

    const { data: assistantMsgRow, error: assistantMsgErr } = await adminClient
      .from("chat_messages")
      .insert({
        user_id: userId,
        role: "assistant",
        content,
        scope_type: "item",
        scope_id: item_id,
      })
      .select()
      .single();

    if (assistantMsgErr) {
      return new Response(
        JSON.stringify({
          error: "Failed to persist assistant message",
          detail: assistantMsgErr.message,
          user_message: userMsgRow,
          ai_content: content,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        user_message: userMsgRow,
        assistant_message: assistantMsgRow,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
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
