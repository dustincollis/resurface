import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

interface FileAttachment {
  name: string;
  type: string; // mime type
  data: string; // base64 encoded
}

// Build Claude content blocks from message text + file attachments
function buildUserContent(
  message: string,
  attachments?: FileAttachment[]
): unknown {
  if (!attachments || attachments.length === 0) {
    return message;
  }

  const content: unknown[] = [];

  for (const file of attachments) {
    const mimeType = file.type;

    if (mimeType.startsWith("image/")) {
      // Images: send as base64 image content block
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType,
          data: file.data,
        },
      });
    } else if (mimeType === "application/pdf") {
      // PDFs: send as document content block
      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: file.data,
        },
      });
    } else if (
      mimeType === "text/csv" ||
      mimeType === "text/plain" ||
      mimeType === "text/markdown" ||
      mimeType.includes("spreadsheetml") ||
      mimeType.includes("presentationml")
    ) {
      // Text-based files: decode and include as text
      try {
        const decoded = atob(file.data);
        content.push({
          type: "text",
          text: `[File: ${file.name}]\n${decoded}`,
        });
      } catch {
        content.push({
          type: "text",
          text: `[File: ${file.name} - could not decode content]`,
        });
      }
    } else {
      // Unknown type: try to decode as text
      try {
        const decoded = atob(file.data);
        content.push({
          type: "text",
          text: `[File: ${file.name}]\n${decoded}`,
        });
      } catch {
        content.push({
          type: "text",
          text: `[File: ${file.name} - unsupported file type: ${mimeType}]`,
        });
      }
    }
  }

  // Add the user's text message
  if (message) {
    content.push({ type: "text", text: message });
  }

  return content;
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

    const { message, chat_history, attachments } = await req.json();
    if (!message && (!attachments || attachments.length === 0)) {
      return new Response(
        JSON.stringify({ error: "message or attachments required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
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

    // Gather context: all user's streams + open items
    const { data: allStreams } = await adminClient
      .from("streams")
      .select("id, name, color")
      .eq("user_id", user.id)
      .eq("is_archived", false)
      .order("sort_order");

    const { data: items } = await adminClient
      .from("items")
      .select(
        "id, title, status, stream_id, staleness_score, next_action, due_date, stakes, resistance, streams(name)"
      )
      .eq("user_id", user.id)
      .not("status", "in", '("done","dropped")')
      .order("staleness_score", { ascending: false })
      .limit(30);

    // Today's meetings
    const today = new Date();
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    ).toISOString();
    const endOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1
    ).toISOString();

    const { data: meetings } = await adminClient
      .from("meetings")
      .select("id, title, start_time, end_time")
      .eq("user_id", user.id)
      .gte("start_time", startOfDay)
      .lt("start_time", endOfDay)
      .order("start_time");

    // Search for referenced entities
    let searchResults = null;
    if (message && message.length > 10) {
      const { data: results } = await adminClient.rpc("search_everything", {
        search_query: message.substring(0, 100),
        searching_user_id: user.id,
        max_results: 5,
      });
      searchResults = results;
    }

    // Build items summary — include full UUID so AI can use it in update_item
    const itemsSummary =
      items
        ?.map(
          (i) =>
            `- id=${i.id} | "${i.title}" | status=${i.status} | stream=${(i.streams as { name: string } | null)?.name ?? "NONE"} | staleness=${i.staleness_score?.toFixed(0) ?? 0} | stakes=${i.stakes ?? "?"} | next=${i.next_action ?? "none"}${i.due_date ? ` | due=${i.due_date}` : ""}`
        )
        .join("\n") ?? "No open items.";

    const streamsSummary =
      allStreams && allStreams.length > 0
        ? allStreams.map((s) => `- "${s.name}"`).join("\n")
        : "(none yet)";

    const meetingsSummary = meetings?.length
      ? meetings
          .map(
            (m) =>
              `- "${m.title}" at ${new Date(m.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
          )
          .join("\n")
      : "No meetings today.";

    const searchContext = searchResults?.length
      ? `\nSearch results for references in the message:\n${searchResults.map((r: { title: string; result_type: string; snippet: string }) => `- [${r.result_type}] "${r.title}": ${r.snippet}`).join("\n")}`
      : "";

    // File context description
    const fileContext =
      attachments && attachments.length > 0
        ? `\nThe user has attached ${attachments.length} file(s): ${(attachments as FileAttachment[]).map((f) => `${f.name} (${f.type})`).join(", ")}. Review and analyze the attached files as part of your response.`
        : "";

    const systemPrompt = `You are the AI assistant for Resurface, a multi-stream task management system.

CONTEXT
=======
Available streams (these already exist — DO NOT propose creating duplicates):
${streamsSummary}

Open items (${items?.length ?? 0} total) — note the id values, you'll need them for update_item actions:
${itemsSummary}

Today's meetings:
${meetingsSummary}
${searchContext}
${fileContext}

YOUR CAPABILITIES
=================
When the user asks you to create items or streams, or you identify ones worth creating, propose them in the "actions" array. The user sees each proposal as a card with a "Create" button — they confirm each one. Be proactive about proposing, but the user has the final say. Update actions for existing items execute immediately since they're less risky.

You can propose:
- New work items (tasks)
- New streams (categories) — only when none of the existing streams fit
- Updates to existing items (these execute immediately)

OUTPUT FORMAT
=============
Your ENTIRE response MUST be a single valid JSON object — nothing else. No prose before, no prose after, no code fences, no markdown.

Response shape:
{
  "message": "your conversational reply to the user as plain text",
  "actions": [...]
}

The "message" field is what the user reads. Write it naturally, conversationally, as if texting a colleague. Plain text only — no markdown asterisks, no JSON, no code blocks. Mention what you did (e.g. "Created 5 items based on your spreadsheet").

The "actions" array contains operations. Each action is an object:

Propose a new item (user will confirm):
{"action": "create_item", "title": "string", "description": "string", "stream_name": "string", "next_action": "string", "due_date": "YYYY-MM-DD or null"}

Propose a new stream (user will confirm):
{"action": "create_stream", "name": "string", "color": "#RRGGBB"}
Suggested colors: #3B82F6 (blue), #22C55E (green), #8B5CF6 (purple), #EF4444 (red), #EAB308 (yellow), #06B6D4 (cyan), #F97316 (orange), #EC4899 (pink)

Update an existing item (executes immediately — use the FULL id from the items list above):
{"action": "update_item", "item_id": "<full uuid from items list>", "updates": {"status": "open|in_progress|waiting|done|dropped", "next_action": "string", "stream_name": "string"}}

Updatable fields in "updates":
- status
- next_action
- stream_name (use the exact stream name from the streams list — server resolves to id)
- due_date (YYYY-MM-DD or null)
- description

EXAMPLES
========

User: "What should I work on?"
Response:
{"message": "Based on your open items, I'd focus on these three first: the Q2 pipeline review (due today), the Datadog vendor follow-up (getting stale), and the team 1:1 prep (high stakes). The pipeline review is the most urgent.", "actions": []}

User: "Create a task to call John about the contract"
Response:
{"message": "Here's a proposed task for you to review.", "actions": [{"action": "create_item", "title": "Call John about the contract", "description": "", "stream_name": "Business Development", "next_action": "Schedule call with John this week"}]}

User: "Here's my to-do list, please add these as items"
Response:
{"message": "I found 5 tasks worth tracking. Each is shown below — click Create to add the ones you want.", "actions": [{"action": "create_item", "title": "...", "stream_name": "...", "next_action": "..."}, {"action": "create_item", ...}]}

User: "Create streams for my main work areas based on what I'm working on"
Response:
{"message": "I see you're working across a few areas. Here are streams I'd suggest creating — click Create on the ones you want.", "actions": [{"action": "create_stream", "name": "Adobe Partnerships", "color": "#3B82F6"}, {"action": "create_stream", "name": "Internal Operations", "color": "#22C55E"}, {"action": "create_stream", "name": "Business Development", "color": "#8B5CF6"}]}

User: "Categorize my unassigned tasks into the right streams"
Response:
{"message": "I assigned 4 unassigned items to streams that fit. The Adobe items went to Adobe Partnerships, the proposal work to Business Development, and the team management items to Internal Operations.", "actions": [{"action": "update_item", "item_id": "<full uuid from items list>", "updates": {"stream_name": "Adobe Partnerships"}}, {"action": "update_item", "item_id": "<full uuid>", "updates": {"stream_name": "Business Development"}}]}

CRITICAL RULES FOR STREAM ASSIGNMENT
====================================
- When the user asks to "categorize", "assign streams to", "organize", or similar — use update_item with stream_name in the updates object. DO NOT create new streams unless none of the existing streams fit.
- Only propose create_stream when the user explicitly asks to create new streams, OR when the existing streams clearly don't cover an item's category.
- Use the FULL uuid from the items list for item_id, not the prefix.
- update_item executes immediately (no user confirmation needed) since it's modifying existing data, so be confident in your assignments.

RULES
=====
- ALWAYS be conversational in the message field. Never put JSON, code, or structured data in the message text.
- When the user gives you content to organize (spreadsheets, notes, lists), CREATE items via the actions array. Don't just describe what you would create.
- Match stream_name to existing streams when possible. If no good match exists, omit stream_name.
- Be concise. The message should be 1-3 sentences unless the user asks for more detail.
- Begin your response with { and end with }. Nothing else.`;

    // Build messages array with history
    const messages: { role: string; content: unknown }[] = [];

    if (chat_history && Array.isArray(chat_history)) {
      for (const msg of chat_history.slice(-20)) {
        messages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        });
      }
    }

    // Build the current user message with attachments
    messages.push({
      role: "user",
      content: buildUserContent(
        message ?? "",
        attachments as FileAttachment[] | undefined
      ),
    });

    // Prefill assistant response with "{" to force JSON output
    messages.push({
      role: "assistant",
      content: "{",
    });

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
        max_tokens: 4096,
        temperature: 0.3,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", errText);
      return new Response(JSON.stringify({ error: "AI chat failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await response.json();
    let rawContent = aiResponse.content?.[0]?.text ?? "";

    // Prepend the "{" we prefilled (the model continues from after it)
    if (!rawContent.trim().startsWith("{")) {
      rawContent = "{" + rawContent;
    }

    // Strip any code fence wrapping the model might have added
    let cleanContent = rawContent.trim();
    if (cleanContent.startsWith("```")) {
      cleanContent = cleanContent
        .replace(/^```(?:json)?\s*\n?/, "")
        .replace(/\n?```\s*$/, "");
    }

    // Try to extract JSON object even if there's text around it
    let parsedResponse: { message: string; actions?: unknown[] };
    try {
      parsedResponse = JSON.parse(cleanContent);
    } catch {
      // Try to find JSON object in the text
      const jsonMatch = cleanContent.match(/\{[\s\S]*"message"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsedResponse = JSON.parse(jsonMatch[0]);
        } catch {
          parsedResponse = { message: cleanContent, actions: [] };
        }
      } else {
        parsedResponse = { message: cleanContent, actions: [] };
      }
    }

    // Process actions: create_item and create_stream become proposals
    // (user must confirm), update_item executes immediately
    const actionsTaken: Record<string, unknown>[] = [];

    if (parsedResponse.actions && Array.isArray(parsedResponse.actions)) {
      for (const action of parsedResponse.actions) {
        const a = action as Record<string, unknown>;
        try {
          if (a.action === "create_item") {
            actionsTaken.push({
              type: "proposed_item",
              title: (a.title as string) ?? "",
              description: (a.description as string) ?? "",
              stream_name: (a.stream_name as string) ?? null,
              next_action: (a.next_action as string) ?? null,
              due_date: (a.due_date as string) ?? null,
            });
          } else if (a.action === "create_stream") {
            actionsTaken.push({
              type: "proposed_stream",
              name: (a.name as string) ?? "",
              color: (a.color as string) ?? null,
              icon: (a.icon as string) ?? null,
            });
          } else if (a.action === "update_item" && a.item_id) {
            const updates = { ...(a.updates as Record<string, unknown>) };
            if (updates) {
              // Resolve stream_name → stream_id
              if (typeof updates.stream_name === "string") {
                const targetName = (updates.stream_name as string).toLowerCase();
                const matchedStream = allStreams?.find(
                  (s) => s.name.toLowerCase() === targetName
                );
                if (matchedStream) {
                  updates.stream_id = matchedStream.id;
                }
                delete updates.stream_name;
              }

              // Strip any unknown/unsupported fields for safety
              const allowedFields = new Set([
                "status",
                "next_action",
                "stream_id",
                "due_date",
                "description",
                "title",
                "resistance",
                "stakes",
              ]);
              for (const key of Object.keys(updates)) {
                if (!allowedFields.has(key)) delete updates[key];
              }

              if (Object.keys(updates).length > 0) {
                const { error } = await adminClient
                  .from("items")
                  .update(updates)
                  .eq("id", a.item_id)
                  .eq("user_id", user.id);

                if (!error) {
                  actionsTaken.push({
                    type: "updated",
                    item_id: a.item_id as string,
                  });
                }
              }
            }
          }
        } catch (err) {
          console.error("Action execution error:", err);
        }
      }
    }

    // Save messages to chat_messages table
    const userMsgContent =
      attachments && attachments.length > 0
        ? `${message ?? ""}\n\n[Attached: ${(attachments as FileAttachment[]).map((f) => f.name).join(", ")}]`
        : message;

    // Insert sequentially to guarantee user message has earlier created_at
    // (single INSERT gives both rows identical timestamps; ordering then becomes arbitrary)
    await adminClient.from("chat_messages").insert({
      user_id: user.id,
      role: "user",
      content: userMsgContent,
    });

    // Tiny delay to guarantee distinct timestamps
    await new Promise((resolve) => setTimeout(resolve, 10));

    await adminClient.from("chat_messages").insert({
      user_id: user.id,
      role: "assistant",
      content: parsedResponse.message,
      actions_taken: actionsTaken,
    });

    return new Response(
      JSON.stringify({
        message: parsedResponse.message,
        actions_taken: actionsTaken,
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
