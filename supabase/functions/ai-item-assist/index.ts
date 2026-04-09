// ai-item-assist: persistent "Help me" generator for items.
//
// Takes an item_id + assist_type and:
//   1. Verifies ownership (user JWT or service role)
//   2. Gathers context: item details, source meeting if any, linked items,
//      pursuit memberships, sibling commitments, recent activity
//   3. Calls Claude with an assist-type-specific prompt
//   4. Upserts into item_assists (regenerate = overwrite)
//   5. Returns the generated content
//
// Three assist types:
//   approach — how to start, what to gather, who to involve
//   context  — what's been said about this across the user's data
//   draft    — a ready-to-use artifact (email, agenda, outline, etc)
//
// The function is dual-auth like ai-parse-transcript: works with both
// browser-side user JWTs and service-role calls. Deploy with --no-verify-jwt.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

type AssistType = "approach" | "context" | "draft";

const ASSIST_INSTRUCTIONS: Record<AssistType, string> = {
  approach: `You are helping the user figure out HOW to make progress on this task. Be specific and practical. Output 4-7 numbered steps. Each step should:

- Start with a concrete verb ("Email Sarah to...", "Pull the latest data from...", "Schedule a 30-min call with...")
- Name specific people, tools, or artifacts when context allows
- Avoid generic advice like "communicate clearly" or "stay organized"

Start with the FIRST physical action (the smallest possible next move), then expand. End with how to know the task is done.

Format as a markdown numbered list. No preamble. No closing summary.`,

  context: `You are summarizing what the user already knows about this task, drawn from their linked meetings, related items, and any pursuit context. The goal is to spare the user from re-reading meeting transcripts to get oriented.

Output four short sections under these exact headings:

## What this is about
2-3 sentences. The high-level "what and why."

## What's been discussed
Bullet points of specific things people have said, decided, or surfaced. CITE the source ("In the [meeting title] discussion, [person] said..."). Be concrete — quote where useful.

## Open questions
Bullet points of things that are still unresolved according to the source material. If none, write "Nothing flagged as unresolved."

## Who's involved
Names from the source materials, with their role/position if you can infer it.

If the source materials are thin (no meeting, no linked items, no pursuit context), say so explicitly: "Limited context — this item has no linked discussion or related work yet." Don't fabricate.`,

  draft: `You are generating a concrete deliverable for this task — something the user can copy, lightly edit, and use immediately.

First, infer from the task title, description, and context what KIND of deliverable makes sense:

- An email (to a person, asking or telling them something)
- A meeting agenda (3-7 topic bullets with time estimates)
- A 1-page outline or status update
- A decision memo (situation / options / recommendation)
- A short script or talking points
- A checklist

Pick the right format. Then write it. Use the user's name where appropriate (signed "Best, [user]" for emails). Don't write "[insert your name]" — write the actual name. Use the names of attendees and counterparts from context.

Output ONLY the artifact itself in markdown — no explanation of what you chose, no preamble, no commentary. The user should be able to copy-paste it directly.`,
};

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

    const { item_id, assist_type } = await req.json();
    if (!item_id || !assist_type) {
      return new Response(
        JSON.stringify({ error: "item_id and assist_type required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (!["approach", "context", "draft"].includes(assist_type)) {
      return new Response(
        JSON.stringify({
          error: `Invalid assist_type: ${assist_type}. Must be approach, context, or draft.`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Auth: dual-mode (user JWT or service role)
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isServiceRole = token === serviceRoleKey;

    let userId: string;
    if (isServiceRole) {
      // Service role calls: derive user_id from the item record
      const { data: item } = await adminClient
        .from("items")
        .select("user_id")
        .eq("id", item_id)
        .single();
      if (!item) {
        return new Response(JSON.stringify({ error: "Item not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = (item as { user_id: string }).user_id;
    } else {
      const {
        data: { user },
      } = await adminClient.auth.getUser(token);
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    // ============================================================
    // Gather context
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

    // User's display name for personalized drafts
    const { data: profile } = await adminClient
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .single();
    const userDisplayName: string =
      ((profile?.display_name as string | undefined) ?? "").trim() || "the user";

    // Pursuits this item belongs to (for context and naming the thread)
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

    // Sibling items: other items in the same pursuits (max 10)
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

    // Related commitments: ones tied to the same source meeting (if any)
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

    // Linked items via item_links
    const { data: linkRows } = await adminClient
      .from("item_links")
      .select("source_item_id, target_item_id, link_type, source_item:items!source_item_id(id, title, status), target_item:items!target_item_id(id, title, status)")
      .or(`source_item_id.eq.${item_id},target_item_id.eq.${item_id}`)
      .limit(10);
    const linkedItems: Array<{ title: string; status: string; relation: string }> = [];
    for (const row of linkRows ?? []) {
      const r = row as Record<string, unknown>;
      const isSource = r.source_item_id === item_id;
      const linked = isSource ? r.target_item : r.source_item;
      if (linked && typeof linked === "object") {
        const li = linked as { title?: string; status?: string };
        linkedItems.push({
          title: li.title ?? "(untitled)",
          status: li.status ?? "open",
          relation: r.link_type as string,
        });
      }
    }

    // ============================================================
    // Build the prompt
    // ============================================================

    const contextLines: string[] = [];
    contextLines.push(`USER NAME: ${userDisplayName}`);
    contextLines.push(`TODAY'S DATE: ${new Date().toISOString().split("T")[0]}`);
    contextLines.push("");
    contextLines.push("THE ITEM:");
    contextLines.push(`  Title: ${item.title}`);
    if (item.description) contextLines.push(`  Description: ${item.description}`);
    if (item.next_action) contextLines.push(`  Next action: ${item.next_action}`);
    if (item.due_date) contextLines.push(`  Due: ${item.due_date}`);
    if ((item.streams as { name?: string } | null)?.name) {
      contextLines.push(`  Stream: ${(item.streams as { name: string }).name}`);
    }
    const company = (item.custom_fields as Record<string, unknown> | null)?.company;
    if (company) contextLines.push(`  Company: ${company}`);
    contextLines.push("");

    if (sourceMeeting) {
      contextLines.push("SOURCE MEETING:");
      contextLines.push(`  Title: ${sourceMeeting.title}`);
      if (sourceMeeting.start_time) {
        contextLines.push(`  Date: ${new Date(sourceMeeting.start_time).toISOString().split("T")[0]}`);
      }
      if (sourceMeeting.attendees && sourceMeeting.attendees.length > 0) {
        contextLines.push(`  Attendees: ${sourceMeeting.attendees.join(", ")}`);
      }
      if (sourceMeeting.transcript_summary) {
        contextLines.push(`  Summary:`);
        contextLines.push(
          sourceMeeting.transcript_summary
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n")
        );
      }
      contextLines.push("");
    }

    if (pursuits.length > 0) {
      contextLines.push("PURSUITS THIS ITEM BELONGS TO:");
      for (const p of pursuits) {
        const parts = [p.name];
        if (p.company) parts.push(`(${p.company})`);
        contextLines.push(`  - ${parts.join(" ")}`);
        if (p.description) contextLines.push(`    ${p.description}`);
      }
      contextLines.push("");
    }

    if (siblingItems.length > 0) {
      contextLines.push("OTHER ITEMS IN THE SAME PURSUITS:");
      for (const s of siblingItems) {
        contextLines.push(`  - [${s.status}] ${s.title}`);
      }
      contextLines.push("");
    }

    if (relatedCommitments.length > 0) {
      contextLines.push("COMMITMENTS FROM THE SAME SOURCE MEETING:");
      for (const c of relatedCommitments) {
        const dir = c.direction === "incoming" ? "← " : "→ ";
        const who = c.counterpart ? ` ${dir}${c.counterpart}` : "";
        const when = c.do_by ? ` (do by ${c.do_by})` : "";
        contextLines.push(`  - [${c.status}] ${c.title}${who}${when}`);
      }
      contextLines.push("");
    }

    if (linkedItems.length > 0) {
      contextLines.push("LINKED ITEMS:");
      for (const l of linkedItems) {
        contextLines.push(`  - [${l.status}] (${l.relation}) ${l.title}`);
      }
      contextLines.push("");
    }

    const instructions = ASSIST_INSTRUCTIONS[assist_type as AssistType];
    const prompt = `${instructions}\n\n--- CONTEXT ---\n\n${contextLines.join("\n")}`;

    // ============================================================
    // Call Claude
    // ============================================================

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
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", errText);
      return new Response(
        JSON.stringify({
          error: "AI assist generation failed",
          detail: errText.substring(0, 500),
          status: response.status,
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
        JSON.stringify({ error: "AI returned empty content" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ============================================================
    // Upsert into item_assists (regenerate = overwrite)
    // ============================================================

    const { data: upserted, error: upsertErr } = await adminClient
      .from("item_assists")
      .upsert(
        {
          user_id: userId,
          item_id,
          assist_type,
          content,
          model: "claude-sonnet-4-20250514",
          generated_at: new Date().toISOString(),
        },
        { onConflict: "item_id,assist_type" }
      )
      .select()
      .single();

    if (upsertErr) {
      console.error("Upsert error:", upsertErr);
      return new Response(
        JSON.stringify({
          error: "Failed to save assist",
          detail: upsertErr.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify(upserted), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
