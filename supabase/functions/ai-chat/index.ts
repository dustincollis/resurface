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

    const systemPrompt = `You are the AI assistant for Resurface, a multi-stream task management system. You help the user manage their work items, understand priorities, and stay on top of everything.

Current context:
Open items (${items?.length ?? 0} total):
${itemsSummary}

Today's meetings:
${meetingsSummary}
${searchContext}
${fileContext}

Behavior:
- Be conversational, natural, and concise. Write plain prose responses.
- DO NOT use markdown formatting like **bold** or *italic* — just write naturally.
- When the user shares files, analyze their content and provide useful insights.
- When asked "what should I do next?", recommend 3-5 items based on staleness, stakes, and due dates.
- When asked to break down an item, suggest 3-5 sub-tasks.
- When the user dumps unstructured text about a meeting or task, proactively suggest extracting items.

CRITICAL OUTPUT FORMAT:
You MUST respond with ONLY a valid JSON object, no markdown wrapping, no code fences, no text before or after. The JSON has this exact shape:
{
  "message": "your conversational response as a plain string",
  "actions": []
}

The "actions" array contains items to create or update. Only include actions when you actually need to modify data:
- {"action": "create_item", "title": "...", "description": "...", "stream_name": "...", "next_action": "..."}
- {"action": "update_item", "item_id": "...", "updates": {"status": "...", "next_action": "...", ...}}

If you don't need to take any actions, use an empty array: "actions": []
The user only sees the "message" field — your conversational response. They never see the JSON wrapper.`;

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
        temperature: 0.7,
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
    const rawContent = aiResponse.content?.[0]?.text ?? "";

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
