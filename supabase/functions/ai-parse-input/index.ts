// ai-parse-input
//
// Reads a row from the `inputs` table (an email, screenshot, or pasted
// text snippet) and runs the same kind of action-item extraction that
// ai-parse-transcript runs on meeting transcripts. Writes results as
// pending proposals with source_type='input', source_id=<input.id>.
//
// Screenshots use multimodal Claude: the image is downloaded from the
// `transcripts` storage bucket and sent as a base64 image content block.
// Emails and pasted_text go through as plain text.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import { recordAiCall } from "../_shared/telemetry.ts";

const STORAGE_BUCKET = "transcripts";
const CLAUDE_MODEL = "claude-opus-4-6";

interface InputRow {
  id: string;
  user_id: string;
  input_type: "email" | "screenshot" | "pasted_text";
  title: string;
  user_description: string | null;
  raw_text: string | null;
  storage_path: string | null;
  mime_type: string | null;
  metadata: Record<string, unknown>;
}

interface ProposalInsert {
  user_id: string;
  proposal_type: "task" | "commitment";
  source_type: "input";
  source_id: string;
  evidence_text: string | null;
  normalized_payload: Record<string, unknown>;
  confidence: number;
  ambiguity_flags: string[];
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

    const { input_id, user_context } = await req.json();
    if (!input_id) {
      return new Response(JSON.stringify({ error: "input_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Auth: verify JWT and ownership.
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user } } = await adminClient.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inputRow, error: inputErr } = await adminClient
      .from("inputs")
      .select("*")
      .eq("id", input_id)
      .single();
    if (inputErr || !inputRow) {
      return new Response(JSON.stringify({ error: "Input not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const input = inputRow as InputRow;
    if (input.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up display name for the prompt's "the user is X" instruction.
    const { data: profile } = await adminClient
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .single();
    const userDisplayName: string =
      (profile?.display_name as string | undefined)?.trim() ||
      user.email?.split("@")[0] ||
      "the user";

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const dayOfWeek = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(today);

    // Split system (stable, cacheable) from user message (per-call).
    // NOTE: the current system prompt is ~3K tokens, below Opus 4.6's 4096
    // minimum cacheable prefix — cache won't fire yet, but the structure is
    // in place so it will activate automatically if the prompt grows.
    const systemPrompt = buildInputSystemPrompt(userDisplayName);
    const userText = buildInputUserText({
      input,
      userContext: typeof user_context === "string" ? user_context : "",
      todayStr,
      dayOfWeek,
    });

    // Assemble the user-message content blocks. For screenshots, the image
    // goes first and the text prompt references it.
    const contentBlocks: Array<Record<string, unknown>> = [];

    if (input.input_type === "screenshot") {
      if (!input.storage_path) {
        return new Response(
          JSON.stringify({ error: "Screenshot input missing storage_path" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { data: fileData, error: downloadErr } = await adminClient
        .storage
        .from(STORAGE_BUCKET)
        .download(input.storage_path);
      if (downloadErr || !fileData) {
        return new Response(
          JSON.stringify({ error: "Failed to download screenshot", detail: downloadErr?.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const buf = new Uint8Array(await fileData.arrayBuffer());
      const base64 = bytesToBase64(buf);
      contentBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: input.mime_type ?? "image/png",
          data: base64,
        },
      });
    }

    contentBlocks.push({ type: "text", text: userText });

    // Call Claude.
    const claudeStart = Date.now();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        temperature: 0.3,
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: contentBlocks }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[ai-parse-input] Claude error:", errText);
      await adminClient
        .from("inputs")
        .update({ processing_error: errText.substring(0, 500) })
        .eq("id", input.id);
      return new Response(
        JSON.stringify({ error: "AI parsing failed", detail: errText.substring(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiJson = await response.json();
    const raw = (aiJson.content?.[0]?.text ?? "").trim();
    const cleaned = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    const claudeLatencyMs = Date.now() - claudeStart;

    // Durable telemetry — see ai_call_telemetry table.
    await recordAiCall(adminClient, {
      user_id: user.id,
      function_name: "ai-parse-input",
      model: CLAUDE_MODEL,
      usage: aiJson.usage,
      stop_reason: aiJson.stop_reason ?? null,
      latency_ms: claudeLatencyMs,
      source_type: "input",
      source_id: input.id,
      metadata: { input_type: input.input_type },
    });

    let parsed: {
      action_items?: Array<Record<string, unknown>>;
      commitments?: Array<Record<string, unknown>>;
    };
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.error("[ai-parse-input] JSON parse error:", err, "raw:", raw.substring(0, 500));
      await adminClient
        .from("inputs")
        .update({ processing_error: "AI returned invalid JSON" })
        .eq("id", input.id);
      return new Response(
        JSON.stringify({ error: "AI response malformed", raw: raw.substring(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const actionItems = Array.isArray(parsed.action_items) ? parsed.action_items : [];
    const commitments = Array.isArray(parsed.commitments) ? parsed.commitments : [];

    const taskProposals: ProposalInsert[] = actionItems
      .filter((a) => typeof a.title === "string" && (a.title as string).trim().length > 0)
      .map((a) => {
        const flags: string[] = Array.isArray(a.ambiguity_flags) ? [...(a.ambiguity_flags as string[])] : [];
        if (!a.suggested_due_date) flags.push("no_due_date");
        const confidence = a.commitment_strength === "implied" ? 0.55 : 0.75;
        const evidence = typeof a.evidence_quote === "string" ? (a.evidence_quote as string).trim() : null;
        return {
          user_id: user.id,
          proposal_type: "task" as const,
          source_type: "input" as const,
          source_id: input.id,
          evidence_text: evidence,
          normalized_payload: {
            title: a.title,
            description: a.description ?? "",
            due_date: a.suggested_due_date ?? null,
            company: a.company ?? null,
            assignee: a.assignee ?? null,
            urgency: a.urgency ?? null,
            commitment_strength: a.commitment_strength ?? null,
          },
          confidence,
          ambiguity_flags: flags,
        };
      });

    const commitmentProposals: ProposalInsert[] = commitments
      .filter((c) => typeof c.title === "string" && (c.title as string).trim().length > 0)
      .map((c) => {
        const flags: string[] = Array.isArray(c.ambiguity_flags) ? [...(c.ambiguity_flags as string[])] : [];
        if (!c.do_by && !c.promised_by && !flags.includes("relative_date")) flags.push("relative_date");
        if (!c.counterpart && !flags.includes("no_counterpart")) flags.push("no_counterpart");
        const evidence = typeof c.evidence_quote === "string" ? (c.evidence_quote as string).trim() : null;
        return {
          user_id: user.id,
          proposal_type: "commitment" as const,
          source_type: "input" as const,
          source_id: input.id,
          evidence_text: evidence,
          normalized_payload: {
            title: c.title,
            description: c.description ?? "",
            counterpart: c.counterpart ?? null,
            company: c.company ?? null,
            do_by: c.do_by ?? null,
            promised_by: c.promised_by ?? null,
            needs_review_by: c.needs_review_by ?? null,
          },
          confidence: 0.6,
          ambiguity_flags: flags,
        };
      });

    const allRows = [...taskProposals, ...commitmentProposals];

    if (allRows.length > 0) {
      const { error: insertErr } = await adminClient.from("proposals").insert(allRows);
      if (insertErr) {
        console.error("[ai-parse-input] proposal insert error:", insertErr);
      }
    }

    await adminClient
      .from("inputs")
      .update({ processed_at: new Date().toISOString(), processing_error: null })
      .eq("id", input.id);

    return new Response(
      JSON.stringify({
        proposals_created: taskProposals.length,
        commitments_created: commitmentProposals.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[ai-parse-input] error:", err);
    return new Response(
      JSON.stringify({ error: "Unexpected server error", detail: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Prompt builders — split into a stable `system` prompt (cacheable) and a
// per-call `user` text block. The render order is tools → system → messages,
// so a cache_control marker on the system block caches everything before the
// per-call variables.
// ---------------------------------------------------------------------------

interface UserTextArgs {
  input: InputRow;
  userContext: string;
  todayStr: string;
  dayOfWeek: string;
}

function buildInputSystemPrompt(userDisplayName: string): string {
  return `You are extracting action items and commitments from content ${userDisplayName} captured for review. Treat this the way you would a meeting transcript: identify specific things ${userDisplayName} needs to do, or things they promised to do, or things others promised them.

The user message will provide:
- TODAY's date (for resolving relative dates like "by Friday", "next week")
- The user's bio/context (optional)
- INPUT TYPE (email / screenshot / pasted_text) with type-specific guidance
- Any user-supplied description of the content
- The content itself (as text, or as an image preceding the text block)

Return a JSON object with two arrays: "action_items" (things the user needs to do) and "commitments" (promises -- either the user's outgoing, or incoming from others).

Each action_item:
{
  "title": "short imperative title",
  "description": "one-sentence context",
  "assignee": "user" | "other" | name,
  "suggested_due_date": "YYYY-MM-DD" | null,
  "urgency": "high" | "medium" | "low" | null,
  "commitment_strength": "explicit" | "implied" | null,
  "company": "name" | null,
  "evidence_quote": "short quote from the content that supports this",
  "ambiguity_flags": []
}

Each commitment:
{
  "title": "short description of what's owed",
  "description": "one-sentence context",
  "counterpart": "name of the other party" | null,
  "company": "name" | null,
  "do_by": "YYYY-MM-DD" | null,
  "promised_by": "YYYY-MM-DD" | null,
  "evidence_quote": "short quote",
  "ambiguity_flags": []
}

Rules:
- Only include action items for ${userDisplayName} -- things THEY need to do. Things only other people need to do are not action items for this user.
- Do include incoming commitments (things others promised the user), so the user can track what they're waiting on.
- Be willing to identify implied action items -- things that would obviously need to happen next even if not stated verbatim. Mark them commitment_strength="implied".
- Resolve relative dates ("by Friday", "next week") against the TODAY date in the user message.
- If nothing actionable is in the content, return empty arrays. Do not invent.
- Return ONLY the JSON object. No prose, no code fences.`;
}

function buildInputUserText({ input, userContext, todayStr, dayOfWeek }: UserTextArgs): string {
  const typeSpecific = inputTypeInstruction(input);
  const descriptionBlock = input.user_description
    ? `\nUSER DESCRIPTION (context the user typed when sharing this):\n${input.user_description}\n`
    : "";
  const contentBlock = input.input_type === "screenshot"
    ? "\nThe image above is the content to analyze."
    : `\nCONTENT:\n${input.raw_text ?? ""}\n`;

  return `TODAY: ${dayOfWeek}, ${todayStr}
${userContext ? "\n" + userContext + "\n" : ""}
${typeSpecific}
${descriptionBlock}${contentBlock}`;
}

function inputTypeInstruction(input: InputRow): string {
  switch (input.input_type) {
    case "email":
      return `INPUT TYPE: Email
The content below is a raw email (MIME-ish) or email body. Ignore email signatures, disclaimers, and quoted reply threads when scoring relevance -- focus on the active part of the message. If sender/subject are parseable, use them for context.`;
    case "screenshot":
      return `INPUT TYPE: Screenshot
The image above is a screenshot the user took of a message they received or sent -- possibly Teams, Slack, iMessage, or an email client. Read the message content as if it were the transcript of a short exchange. Identify who is speaking (the user or someone else) from context clues like sender name, avatar position, or which side of the chat the bubbles are on.`;
    case "pasted_text":
      return `INPUT TYPE: Pasted text
The content below was copy-pasted from somewhere (Slack thread, Teams chat, email body, notes). Infer the context from the text itself -- there may or may not be speaker labels.`;
  }
}

// Uint8Array -> base64 without blowing the stack on large buffers.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
