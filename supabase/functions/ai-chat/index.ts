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

    // Gather context: open items summary
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

    // Build items summary
    const itemsSummary =
      items
        ?.map(
          (i) =>
            `- [${i.id.substring(0, 8)}] "${i.title}" (${i.status}, stream: ${(i.streams as { name: string } | null)?.name ?? "none"}, staleness: ${i.staleness_score?.toFixed(0) ?? 0}, stakes: ${i.stakes ?? "?"}, next: ${i.next_action ?? "none"}${i.due_date ? `, due: ${i.due_date}` : ""})`
        )
        .join("\n") ?? "No open items.";

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

    const availableStreams = items
      ? [...new Set(items.map((i) => (i.streams as { name: string } | null)?.name).filter(Boolean))]
      : [];

    const systemPrompt = `You are the AI assistant for Resurface, a multi-stream task management system.

CONTEXT
=======
Open items (${items?.length ?? 0} total):
${itemsSummary}

Available streams: ${availableStreams.length > 0 ? availableStreams.join(", ") : "(none yet)"}

Today's meetings:
${meetingsSummary}
${searchContext}
${fileContext}

YOUR CAPABILITIES
=================
You can directly create and update work items by including them in the "actions" array of your response. The user does NOT need to confirm — actions you include WILL be executed automatically. Use this capability proactively when the user asks you to create tasks, add items, or organize work.

OUTPUT FORMAT
=============
Your ENTIRE response MUST be a single valid JSON object — nothing else. No prose before, no prose after, no code fences, no markdown.

Response shape:
{
  "message": "your conversational reply to the user as plain text",
  "actions": [...]
}

The "message" field is what the user reads. Write it naturally, conversationally, as if texting a colleague. Plain text only — no markdown asterisks, no JSON, no code blocks. Mention what you did (e.g. "Created 5 items based on your spreadsheet").

The "actions" array contains operations to execute. Each action is an object:

Create an item:
{"action": "create_item", "title": "string", "description": "string", "stream_name": "string", "next_action": "string"}

Update an item (use the 8-character ID prefix from the items list):
{"action": "update_item", "item_id": "string", "updates": {"status": "open|in_progress|waiting|done|dropped", "next_action": "string"}}

EXAMPLES
========

User: "What should I work on?"
Response:
{"message": "Based on your open items, I'd focus on these three first: the Q2 pipeline review (due today), the Datadog vendor follow-up (getting stale), and the team 1:1 prep (high stakes). The pipeline review is the most urgent.", "actions": []}

User: "Create a task to call John about the contract"
Response:
{"message": "Done — created that task in Business Development.", "actions": [{"action": "create_item", "title": "Call John about the contract", "description": "", "stream_name": "Business Development", "next_action": "Schedule call with John this week"}]}

User: "Here's my to-do list, please add these as items"
Response:
{"message": "I added 5 items across your streams: 3 in Business Development, 1 in Internal Operations, and 1 in Technical Development.", "actions": [{"action": "create_item", "title": "...", "stream_name": "...", "next_action": "..."}, {"action": "create_item", ...}]}

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

    // Execute actions
    const executedActions: string[] = [];

    if (parsedResponse.actions && Array.isArray(parsedResponse.actions)) {
      for (const action of parsedResponse.actions) {
        const a = action as Record<string, unknown>;
        try {
          if (a.action === "create_item") {
            let streamId = null;
            if (a.stream_name && items) {
              const stream = items.find(
                (i) =>
                  (i.streams as { name: string } | null)?.name?.toLowerCase() ===
                  (a.stream_name as string).toLowerCase()
              );
              if (stream) streamId = stream.stream_id;
            }

            const { error } = await adminClient.from("items").insert({
              user_id: user.id,
              title: a.title as string,
              description: (a.description as string) ?? "",
              stream_id: streamId,
              next_action: (a.next_action as string) ?? null,
            });

            if (!error) {
              executedActions.push(`Created item: "${a.title}"`);
            }
          } else if (a.action === "update_item" && a.item_id) {
            const updates = a.updates as Record<string, unknown>;
            if (updates) {
              const { error } = await adminClient
                .from("items")
                .update(updates)
                .eq("id", a.item_id)
                .eq("user_id", user.id);

              if (!error) {
                executedActions.push(
                  `Updated item ${(a.item_id as string).substring(0, 8)}`
                );
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

    await adminClient.from("chat_messages").insert([
      {
        user_id: user.id,
        role: "user",
        content: userMsgContent,
      },
      {
        user_id: user.id,
        role: "assistant",
        content: parsedResponse.message,
        actions_taken: executedActions,
      },
    ]);

    return new Response(
      JSON.stringify({
        message: parsedResponse.message,
        actions_taken: executedActions,
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
