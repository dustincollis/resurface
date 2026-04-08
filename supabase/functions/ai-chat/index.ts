import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

interface FileAttachment {
  name: string;
  type: string;
  data: string;
}

// ============================================================
// Tool definitions exposed to Claude
// ============================================================

const TOOLS = [
  {
    name: "list_tasks",
    description:
      "List the user's tasks with optional filters. Returns up to the limit. Use this when the user asks about their tasks, what's due, what's stale, what's in a stream, what's open for a specific company, etc. Defaults to active tasks (open, in_progress, waiting) sorted by staleness.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "in_progress", "waiting", "done", "dropped", "any"],
          description: "Filter by status. Use 'any' to include all statuses.",
        },
        stream_name: {
          type: "string",
          description: "Filter by stream name (case-insensitive). Omit for all streams.",
        },
        company: {
          type: "string",
          description: "Filter by the company / account / client name on the task (custom_fields.company). Case-insensitive substring match.",
        },
        only_overdue: {
          type: "boolean",
          description: "Only items past their due_date",
        },
        only_due_within_days: {
          type: "integer",
          description: "Only items due within N days from today",
        },
        sort_by: {
          type: "string",
          enum: ["staleness_score", "last_touched_at", "due_date", "created_at", "stakes"],
          description: "Sort field",
        },
        limit: {
          type: "integer",
          description: "Max number of tasks to return (default 50, max 200)",
        },
      },
    },
  },
  {
    name: "get_task",
    description:
      "Fetch the full detail of a single task by ID, including stream, parent, source meeting, and custom fields.",
    input_schema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "The task UUID",
        },
      },
      required: ["task_id"],
    },
  },
  {
    name: "search_tasks",
    description:
      "Full-text + fuzzy search across the user's tasks and discussions. Use this when the user mentions a specific topic, person, or company.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (2+ characters)",
        },
        limit: {
          type: "integer",
          description: "Max results (default 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_streams",
    description: "List all the user's active (non-archived) streams.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_task_counts",
    description:
      "Get aggregate counts: total tasks by status, by stream, overdue, stale, etc. Use for high-level questions like 'how many tasks do I have?' or 'how am I doing?'",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_companies",
    description:
      "List all the unique companies / accounts referenced across the user's active tasks, with task counts. Use this for questions like 'what companies am I tracking?' or 'show me all my Acme work'.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

// ============================================================
// Tool implementations
// ============================================================

type SupabaseAdmin = ReturnType<typeof createClient>;

interface ToolContext {
  adminClient: SupabaseAdmin;
  userId: string;
}

async function execListTasks(
  ctx: ToolContext,
  args: Record<string, unknown>
): Promise<unknown> {
  const status = args.status as string | undefined;
  const streamName = args.stream_name as string | undefined;
  const company = args.company as string | undefined;
  const onlyOverdue = args.only_overdue as boolean | undefined;
  const onlyDueWithinDays = args.only_due_within_days as number | undefined;
  const sortBy = (args.sort_by as string | undefined) ?? "staleness_score";
  const limit = Math.min((args.limit as number | undefined) ?? 50, 200);

  let query = ctx.adminClient
    .from("items")
    .select(
      "id, title, description, status, stream_id, staleness_score, next_action, due_date, stakes, resistance, last_touched_at, created_at, custom_fields, streams(name)"
    )
    .eq("user_id", ctx.userId);

  if (status && status !== "any") {
    query = query.eq("status", status);
  } else if (!status) {
    query = query.not("status", "in", '("done","dropped")');
  }

  if (streamName) {
    const { data: stream } = await ctx.adminClient
      .from("streams")
      .select("id")
      .eq("user_id", ctx.userId)
      .ilike("name", streamName)
      .maybeSingle();
    if (stream) {
      query = query.eq("stream_id", stream.id);
    } else {
      return { tasks: [], note: `No stream named "${streamName}" found` };
    }
  }

  if (onlyOverdue) {
    query = query.lt("due_date", new Date().toISOString().split("T")[0]);
  }
  if (onlyDueWithinDays && onlyDueWithinDays > 0) {
    const future = new Date(Date.now() + onlyDueWithinDays * 86400000)
      .toISOString()
      .split("T")[0];
    query = query.lte("due_date", future).not("due_date", "is", null);
  }

  // Fetch a wider page if filtering by company so we don't miss matches
  const fetchLimit = company ? Math.min(limit * 4, 500) : limit;
  query = query.order(sortBy, { ascending: false }).limit(fetchLimit);

  const { data, error } = await query;
  if (error) return { error: error.message };

  // Client-side company filter (substring, case-insensitive)
  let filtered = data ?? [];
  if (company) {
    const target = company.toLowerCase();
    filtered = filtered.filter((t) => {
      const c = (t.custom_fields as Record<string, unknown> | null)?.company;
      return typeof c === "string" && c.toLowerCase().includes(target);
    });
    filtered = filtered.slice(0, limit);
  }

  return {
    count: filtered.length,
    tasks: filtered.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      stream: (t.streams as { name: string } | null)?.name ?? null,
      company: ((t.custom_fields as Record<string, unknown> | null)?.company as string | undefined) ?? null,
      next_action: t.next_action,
      due_date: t.due_date,
      stakes: t.stakes,
      resistance: t.resistance,
      staleness: Math.round(t.staleness_score ?? 0),
      last_touched_at: t.last_touched_at,
      created_at: t.created_at,
      description: t.description ? t.description.substring(0, 200) : null,
    })),
  };
}

async function execGetTask(
  ctx: ToolContext,
  args: Record<string, unknown>
): Promise<unknown> {
  const taskId = args.task_id as string;
  if (!taskId) return { error: "task_id required" };

  const { data, error } = await ctx.adminClient
    .from("items")
    .select(
      "*, streams(name, color, field_templates), parent:items!parent_id(id, title), source_meeting:meetings!source_meeting_id(id, title)"
    )
    .eq("id", taskId)
    .eq("user_id", ctx.userId)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "Task not found" };

  return data;
}

async function execSearchTasks(
  ctx: ToolContext,
  args: Record<string, unknown>
): Promise<unknown> {
  const query = args.query as string;
  const limit = (args.limit as number | undefined) ?? 10;
  if (!query || query.length < 2) return { error: "query must be 2+ characters" };

  const { data, error } = await ctx.adminClient.rpc("search_everything", {
    search_query: query,
    searching_user_id: ctx.userId,
    max_results: limit,
  });

  if (error) return { error: error.message };
  return { count: data?.length ?? 0, results: data };
}

async function execListStreams(ctx: ToolContext): Promise<unknown> {
  const { data, error } = await ctx.adminClient
    .from("streams")
    .select("id, name, color, sort_order")
    .eq("user_id", ctx.userId)
    .eq("is_archived", false)
    .order("sort_order");

  if (error) return { error: error.message };
  return { count: data?.length ?? 0, streams: data };
}

async function execGetTaskCounts(ctx: ToolContext): Promise<unknown> {
  const { data: items } = await ctx.adminClient
    .from("items")
    .select("status, stream_id, due_date, staleness_score, streams(name)")
    .eq("user_id", ctx.userId);

  if (!items) return { error: "Failed to fetch counts" };

  const byStatus: Record<string, number> = {};
  const byStream: Record<string, number> = {};
  let overdueCount = 0;
  let staleCount = 0;
  let dueThisWeek = 0;

  const now = Date.now();
  const weekFromNow = now + 7 * 86400000;

  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    const streamName =
      (item.streams as { name: string } | null)?.name ?? "(no stream)";
    byStream[streamName] = (byStream[streamName] ?? 0) + 1;

    if (item.due_date) {
      const dueMs = new Date(item.due_date).getTime();
      if (dueMs < now && !["done", "dropped"].includes(item.status)) overdueCount++;
      if (dueMs >= now && dueMs <= weekFromNow) dueThisWeek++;
    }

    if ((item.staleness_score ?? 0) >= 60 && !["done", "dropped"].includes(item.status)) {
      staleCount++;
    }
  }

  return {
    total: items.length,
    by_status: byStatus,
    by_stream: byStream,
    overdue: overdueCount,
    stale: staleCount,
    due_this_week: dueThisWeek,
  };
}

async function execListCompanies(ctx: ToolContext): Promise<unknown> {
  const { data: items } = await ctx.adminClient
    .from("items")
    .select("custom_fields, status")
    .eq("user_id", ctx.userId)
    .not("status", "in", '("done","dropped")');

  if (!items) return { error: "Failed to fetch tasks" };

  const counts = new Map<string, number>();
  for (const item of items) {
    const company = (item.custom_fields as Record<string, unknown> | null)?.company;
    if (typeof company === "string" && company.trim()) {
      const key = company.trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const companies = Array.from(counts.entries())
    .map(([name, count]) => ({ name, active_task_count: count }))
    .sort((a, b) => b.active_task_count - a.active_task_count);

  return { count: companies.length, companies };
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<unknown> {
  try {
    switch (name) {
      case "list_tasks":
        return await execListTasks(ctx, input);
      case "get_task":
        return await execGetTask(ctx, input);
      case "search_tasks":
        return await execSearchTasks(ctx, input);
      case "list_streams":
        return await execListStreams(ctx);
      case "get_task_counts":
        return await execGetTaskCounts(ctx);
      case "list_companies":
        return await execListCompanies(ctx);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ============================================================
// Helpers
// ============================================================

function buildUserContent(message: string, attachments?: FileAttachment[]): unknown {
  if (!attachments || attachments.length === 0) return message;

  const content: unknown[] = [];

  for (const file of attachments) {
    const mimeType = file.type;
    if (mimeType.startsWith("image/")) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: mimeType, data: file.data },
      });
    } else if (mimeType === "application/pdf") {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: file.data },
      });
    } else {
      try {
        const decoded = atob(file.data);
        content.push({
          type: "text",
          text: `[File: ${file.name}]\n${decoded}`,
        });
      } catch {
        content.push({
          type: "text",
          text: `[File: ${file.name} - could not decode]`,
        });
      }
    }
  }

  if (message) content.push({ type: "text", text: message });
  return content;
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface ClaudeResponse {
  content: ContentBlock[];
  stop_reason: string;
}

async function callClaude(
  messages: { role: string; content: unknown }[],
  systemPrompt: string,
  anthropicKey: string
): Promise<ClaudeResponse> {
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
      temperature: 0.4,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  return await response.json();
}

// ============================================================
// Main handler
// ============================================================

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

    const { message, chat_history, attachments, user_context } = await req.json();
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

    const ctx: ToolContext = { adminClient, userId: user.id };

    // Pre-fetch streams (for stream_name resolution in actions)
    const { data: allStreams } = await adminClient
      .from("streams")
      .select("id, name, color")
      .eq("user_id", user.id)
      .eq("is_archived", false)
      .order("sort_order");

    const userContextBlock =
      typeof user_context === "string" && user_context.length > 0
        ? `\n${user_context}\n`
        : "";

    const fileContext =
      attachments && attachments.length > 0
        ? `\nThe user has attached ${attachments.length} file(s): ${(attachments as FileAttachment[]).map((f) => `${f.name} (${f.type})`).join(", ")}. Review and analyze them.`
        : "";

    const systemPrompt = `You are the AI assistant for Resurface, a multi-stream task management system. The user calls their work items "tasks".
${userContextBlock}
TOOLS
=====
You have access to live database tools. ALWAYS use them when the user asks about their tasks, streams, or specific items. Do not guess from the conversation history — fetch fresh data via tools.

- list_tasks(status?, stream_name?, company?, only_overdue?, only_due_within_days?, sort_by?, limit?) — list tasks with filters. The "company" filter searches the custom_fields.company on each task.
- get_task(task_id) — full detail for one task
- search_tasks(query) — full-text + fuzzy search across tasks and discussions
- list_streams() — list all active streams
- list_companies() — list all unique companies/accounts referenced in active tasks, with counts
- get_task_counts() — aggregate counts (total, by status, by stream, overdue, stale)

Tasks store their company / account / client name in custom_fields.company. The user organizes a lot of work around which company a task is for. Use list_companies() and the company filter on list_tasks() liberally when the user mentions an org name.

Use multiple tool calls if needed. For example: get_task_counts() first to understand scope, then list_tasks(stream_name: "X") to drill in.
${fileContext}
ACTIONS
=======
After gathering data via tools, you can propose write actions in your final JSON response. Read tools execute live; write actions return as proposals (user clicks Create) or execute immediately (updates).

Proposals (user confirms via Create button):
- {"action": "create_item", "title": "...", "description": "...", "stream_name": "...", "next_action": "...", "due_date": "YYYY-MM-DD or null"}
- {"action": "create_stream", "name": "...", "color": "#RRGGBB"}

Immediate execution:
- {"action": "update_item", "item_id": "<full uuid>", "updates": {"status": "...", "next_action": "...", "stream_name": "...", "due_date": "...", "description": "..."}}

OUTPUT FORMAT
=============
Your FINAL response (after all tool calls are done) MUST be a single valid JSON object:
{
  "message": "your conversational reply to the user, plain text, no markdown asterisks",
  "actions": []
}

The "message" field is what the user reads. Conversational, concise (1-3 sentences unless they ask for detail). No markdown formatting. No JSON or code in the message.
The "actions" array is optional — only include when proposing or updating items.

RULES
=====
- ALWAYS use tools when answering questions about tasks. Don't make up data or rely on memory.
- When categorizing tasks, use update_item with stream_name (don't create new streams unless none fit).
- Match stream_name to existing streams when proposing items.
- Be conversational. Never put JSON in the message text.
- Begin your final text response with { and end with }.`;

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

    messages.push({
      role: "user",
      content: buildUserContent(message ?? "", attachments as FileAttachment[] | undefined),
    });

    // Tool-use loop
    const MAX_LOOPS = 10;
    let loopCount = 0;
    let finalText = "";

    while (loopCount < MAX_LOOPS) {
      loopCount++;

      const response = await callClaude(messages, systemPrompt, anthropicKey);

      // If Claude is done (or stopped for any non-tool reason), grab the text
      if (response.stop_reason !== "tool_use") {
        for (const block of response.content) {
          if (block.type === "text" && block.text) {
            finalText += block.text;
          }
        }
        break;
      }

      // Append the assistant turn (with tool_use blocks)
      messages.push({ role: "assistant", content: response.content });

      // Execute each tool call and append results in a single user turn
      const toolResults: unknown[] = [];
      for (const block of response.content) {
        if (block.type === "tool_use" && block.name && block.id) {
          const result = await executeTool(block.name, block.input ?? {}, ctx);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }

    if (!finalText) {
      finalText = '{"message": "I had trouble generating a response. Try rephrasing?", "actions": []}';
    }

    // Parse the final response as JSON
    let cleanContent = finalText.trim();
    if (cleanContent.startsWith("```")) {
      cleanContent = cleanContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    let parsedResponse: { message: string; actions?: unknown[] };
    try {
      parsedResponse = JSON.parse(cleanContent);
    } catch {
      // Fall back: extract JSON object from text
      const jsonMatch = cleanContent.match(/\{[\s\S]*"message"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsedResponse = JSON.parse(jsonMatch[0]);
        } catch {
          parsedResponse = { message: cleanContent, actions: [] };
        }
      } else {
        // No JSON at all — treat the whole text as the message
        parsedResponse = { message: cleanContent, actions: [] };
      }
    }

    // Process actions: create_item and create_stream become proposals,
    // update_item executes immediately
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
            if (typeof updates.stream_name === "string") {
              const targetName = (updates.stream_name as string).toLowerCase();
              const matchedStream = allStreams?.find(
                (s) => s.name.toLowerCase() === targetName
              );
              if (matchedStream) updates.stream_id = matchedStream.id;
              delete updates.stream_name;
            }
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
        } catch (err) {
          console.error("Action execution error:", err);
        }
      }
    }

    // Save messages to chat_messages table (sequential for distinct timestamps)
    const userMsgContent =
      attachments && attachments.length > 0
        ? `${message ?? ""}\n\n[Attached: ${(attachments as FileAttachment[]).map((f) => f.name).join(", ")}]`
        : message;

    await adminClient.from("chat_messages").insert({
      user_id: user.id,
      role: "user",
      content: userMsgContent,
    });

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
        tool_calls: loopCount - 1, // for debugging — how many tool-use rounds
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
