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

    const { message, chat_history } = await req.json();
    if (!message) {
      return new Response(JSON.stringify({ error: "message required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY")!;
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
      .select("id, title, status, stream_id, staleness_score, next_action, due_date, stakes, resistance, streams(name)")
      .eq("user_id", user.id)
      .not("status", "in", '("done","dropped")')
      .order("staleness_score", { ascending: false })
      .limit(30);

    // Today's meetings
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

    const { data: meetings } = await adminClient
      .from("meetings")
      .select("id, title, start_time, end_time")
      .eq("user_id", user.id)
      .gte("start_time", startOfDay)
      .lt("start_time", endOfDay)
      .order("start_time");

    // Search for referenced entities if the message mentions specific things
    let searchResults = null;
    if (message.length > 10) {
      const { data: results } = await adminClient.rpc("search_everything", {
        search_query: message.substring(0, 100),
        searching_user_id: user.id,
        max_results: 5,
      });
      searchResults = results;
    }

    // Build items summary
    const itemsSummary = items
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

    // Build chat messages for Claude
    const systemPrompt = `You are the AI assistant for Resurface, a multi-stream task management system. You help the user manage their work items, understand priorities, and stay on top of everything.

You can take these actions (return them in an "actions" array in your JSON response):
- {"action": "create_item", "title": "...", "description": "...", "stream_name": "...", "next_action": "..."}
- {"action": "update_item", "item_id": "...", "updates": {"status": "...", "next_action": "...", ...}}
- {"action": "search", "query": "..."}

Current context:
Open items (${items?.length ?? 0} total):
${itemsSummary}

Today's meetings:
${meetingsSummary}
${searchContext}

Rules:
- Be conversational but concise.
- When the user dumps unstructured text about a meeting or task, proactively extract items and suggest creating them.
- When asked "what should I do next?", recommend 3-5 items based on staleness, stakes, and due dates.
- When asked to break down an item, suggest 3-5 sub-tasks.
- Always respond in JSON format: {"message": "your response", "actions": [...]}
- Actions are optional. Only include them when you're actually creating or updating items.`;

    // Build messages array with history
    const messages: { role: string; content: string }[] = [];

    if (chat_history && Array.isArray(chat_history)) {
      for (const msg of chat_history.slice(-20)) {
        messages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        });
      }
    }

    messages.push({ role: "user", content: message });

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
        temperature: 0.7,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", errText);
      return new Response(
        JSON.stringify({ error: "AI chat failed" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiResponse = await response.json();
    const rawContent = aiResponse.content?.[0]?.text ?? "";

    // Try to parse as JSON, fall back to plain text
    let parsedResponse: { message: string; actions?: unknown[] };
    try {
      parsedResponse = JSON.parse(rawContent);
    } catch {
      parsedResponse = { message: rawContent, actions: [] };
    }

    // Execute actions
    const executedActions: string[] = [];

    if (parsedResponse.actions && Array.isArray(parsedResponse.actions)) {
      for (const action of parsedResponse.actions) {
        const a = action as Record<string, unknown>;
        try {
          if (a.action === "create_item") {
            // Find stream by name if provided
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
                executedActions.push(`Updated item ${(a.item_id as string).substring(0, 8)}`);
              }
            }
          }
        } catch (err) {
          console.error("Action execution error:", err);
        }
      }
    }

    // Save messages to chat_messages table
    await adminClient.from("chat_messages").insert([
      {
        user_id: user.id,
        role: "user",
        content: message,
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
