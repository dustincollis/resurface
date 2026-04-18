import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import { embedQuery } from "../_shared/voyage.ts";
import { recordAiCall } from "../_shared/telemetry.ts";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-7";
const MAX_HISTORY = 20; // messages to include in context

// ============================================================
// Tool definitions for reaching into Resurface
// ============================================================

const TOOLS = [
  {
    name: "lookup_person_in_resurface",
    description:
      "Look up a person by name in Resurface. Returns their recent meetings, any commitments (open tasks assigned to/from them), and memories about them. Use this to answer questions like 'any recent interactions with [name]?' or 'what do I owe [name]?'",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Full or partial name of the person to look up",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "lookup_company_in_resurface",
    description:
      "Look up a company/account in Resurface. Returns recent meetings, open items, and any active pursuits for that account. Use for questions like 'what's happening with [company]?' or 'any open commitments for [company]?'",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Company/account name to look up",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "list_bundle_subjects",
    description:
      "List all people and companies mentioned in this bundle's source documents. Returns two arrays: people[] and companies[]. Use to answer 'who's in this bundle?' or 'which accounts are covered?' type questions.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "search_resurface_transcripts",
    description:
      "Full-text search across the user's Resurface meeting transcripts. Use when the user asks about past conversations, prior context on a topic, or what was discussed in a meeting.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search terms — names, topics, companies, etc.",
        },
        limit: {
          type: "integer",
          description: "Max results (default 5, max 10)",
        },
      },
      required: ["query"],
    },
  },
];

// ============================================================
// Tool execution
// ============================================================

async function executeTool(
  name: string,
  // deno-lint-ignore no-explicit-any
  input: Record<string, any>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  bundleId: string
): Promise<string> {
  try {
    switch (name) {
      case "lookup_person_in_resurface": {
        const query = (input.name as string).toLowerCase();
        const [meetingsRes, itemsRes, memoriesRes] = await Promise.all([
          adminClient
            .from("meetings")
            .select("title, start_time, attendees")
            .eq("user_id", userId)
            .ilike("attendees", `%${input.name}%`)
            .order("start_time", { ascending: false })
            .limit(5),
          adminClient
            .from("items")
            .select("title, status, due_date, custom_fields")
            .eq("user_id", userId)
            .ilike("custom_fields->>person", `%${input.name}%`)
            .neq("status", "done")
            .limit(10),
          adminClient
            .from("memories")
            .select("content, created_at")
            .eq("user_id", userId)
            .ilike("content", `%${query}%`)
            .order("created_at", { ascending: false })
            .limit(5),
        ]);

        // Also search by person name in people table
        const { data: person } = await adminClient
          .from("people")
          .select("id, name, email, company_id, companies(name)")
          .eq("user_id", userId)
          .ilike("name", `%${input.name}%`)
          .limit(1)
          .single();

        let personContext = "";
        if (person) {
          const co = (person.companies as { name: string } | null)?.name ?? "";
          personContext = `Person in Resurface: ${person.name}${co ? ` (${co})` : ""}${person.email ? ` <${person.email}>` : ""}\n\n`;
        }

        const meetingsText =
          (meetingsRes.data ?? []).length > 0
            ? `Recent meetings:\n${(meetingsRes.data ?? []).map((m) => `- ${m.title} (${m.start_time?.slice(0, 10)})`).join("\n")}`
            : "No recent meetings found in Resurface.";

        const itemsText =
          (itemsRes.data ?? []).length > 0
            ? `\n\nOpen items:\n${(itemsRes.data ?? []).map((i) => `- ${i.title} [${i.status}]${i.due_date ? ` due ${i.due_date}` : ""}`).join("\n")}`
            : "\n\nNo open items.";

        const memoriesText =
          (memoriesRes.data ?? []).length > 0
            ? `\n\nMemories:\n${(memoriesRes.data ?? []).map((m) => `- ${m.content}`).join("\n")}`
            : "";

        return `${personContext}${meetingsText}${itemsText}${memoriesText}`;
      }

      case "lookup_company_in_resurface": {
        const [meetingsRes, itemsRes, pursuitsRes] = await Promise.all([
          adminClient
            .from("meetings")
            .select("title, start_time")
            .eq("user_id", userId)
            .ilike("title", `%${input.name}%`)
            .order("start_time", { ascending: false })
            .limit(5),
          adminClient
            .from("items")
            .select("title, status, due_date")
            .eq("user_id", userId)
            .ilike("custom_fields->>company", `%${input.name}%`)
            .neq("status", "done")
            .limit(10),
          adminClient
            .from("pursuits")
            .select("name, stage, value_estimate, target_close_date")
            .eq("user_id", userId)
            .ilike("name", `%${input.name}%`)
            .limit(5),
        ]);

        const meetingsText =
          (meetingsRes.data ?? []).length > 0
            ? `Recent meetings:\n${(meetingsRes.data ?? []).map((m) => `- ${m.title} (${m.start_time?.slice(0, 10)})`).join("\n")}`
            : "No recent meetings found.";

        const itemsText =
          (itemsRes.data ?? []).length > 0
            ? `\n\nOpen items:\n${(itemsRes.data ?? []).map((i) => `- ${i.title} [${i.status}]`).join("\n")}`
            : "\n\nNo open items.";

        const pursuitsText =
          (pursuitsRes.data ?? []).length > 0
            ? `\n\nPursuits:\n${(pursuitsRes.data ?? []).map((p) => `- ${p.name} [${p.stage}]${p.value_estimate ? ` ~$${p.value_estimate}` : ""}`).join("\n")}`
            : "";

        return `${meetingsText}${itemsText}${pursuitsText}`;
      }

      case "list_bundle_subjects": {
        const { data: entities } = await adminClient
          .from("bundle_entities")
          .select("entity_type, raw_name, mention_count")
          .eq("bundle_id", bundleId)
          .order("mention_count", { ascending: false });

        const people = (entities ?? [])
          .filter((e) => e.entity_type === "person")
          .map((e) => e.raw_name);
        const companies = (entities ?? [])
          .filter((e) => e.entity_type === "company")
          .map((e) => e.raw_name);

        return JSON.stringify({ people, companies });
      }

      case "search_resurface_transcripts": {
        const limit = Math.min(input.limit ?? 5, 10);
        const { data } = await adminClient.rpc("search_items", {
          searching_user_id: userId,
          query_text: input.query,
          limit_count: limit,
        });

        if (!data || data.length === 0) return "No matching transcripts found.";

        return data
          .map(
            (r: { title: string; content: string; similarity: number }) =>
              `[${r.title}] — ${r.content?.slice(0, 300) ?? ""}...`
          )
          .join("\n\n");
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    return `Tool error: ${String(err)}`;
  }
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SB_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      "";
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    const { bundle_id, message } = await req.json() as {
      bundle_id: string;
      message: string;
    };

    if (!bundle_id || !message?.trim()) {
      return new Response(
        JSON.stringify({ error: "bundle_id and message required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify bundle ownership
    const { data: bundle, error: bundleError } = await adminClient
      .from("bundles")
      .select("id, name, status")
      .eq("id", bundle_id)
      .eq("user_id", userId)
      .single();

    if (bundleError || !bundle) {
      return new Response(JSON.stringify({ error: "Bundle not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --------------------------------------------------------
    // Hybrid retrieval: embed query → pgvector + FTS
    // --------------------------------------------------------
    const queryEmbedding = await embedQuery(message);

    const { data: chunks } = await adminClient.rpc("search_bundle_chunks", {
      p_bundle_id: bundle_id,
      p_user_id: userId,
      query_embedding: JSON.stringify(queryEmbedding),
      query_text: message,
      match_count: 8,
      similarity_threshold: 0.2,
    });

    const contextBlocks = (chunks ?? [])
      .map(
        (c: { section_path: string; content: string }) =>
          `[${c.section_path}]\n${c.content}`
      )
      .join("\n\n---\n\n");

    // --------------------------------------------------------
    // Load chat history
    // --------------------------------------------------------
    const { data: history } = await adminClient
      .from("chat_messages")
      .select("role, content")
      .eq("user_id", userId)
      .eq("scope_type", "bundle")
      .eq("scope_id", bundle_id)
      .order("created_at", { ascending: true })
      .limit(MAX_HISTORY);

    const historyMessages = (history ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
    }));

    // Save user message
    await adminClient.from("chat_messages").insert({
      user_id: userId,
      role: "user",
      content: message,
      scope_type: "bundle",
      scope_id: bundle_id,
    });

    // --------------------------------------------------------
    // Build system prompt
    // --------------------------------------------------------
    const systemPrompt = `You are a real-time briefing assistant for Dustin Collis at Adobe Summit 2026.

You have access to two sources of information:
1. BUNDLE CONTEXT: The pre-curated briefing documents shown below (retrieved sections most relevant to the current question)
2. RESURFACE TOOLS: Tool calls that reach into Dustin's live Resurface database for commitments, meetings, people, and pursuits

Rules for answers:
- Cite every factual claim with [Section Name] from the bundle, or [Resurface] for tool call results
- If a question requires Resurface context (e.g., "any recent interactions with X?"), call the tool — don't guess
- If something is not in the bundle or Resurface, say so directly — do not fabricate
- Keep answers concise and mobile-readable — bullets and short sentences
- Surface conflicts, gaps, and unknowns honestly

RETRIEVED BUNDLE CONTEXT (sections most relevant to this query):
${contextBlocks || "(No matching sections found — try rephrasing or ask about a specific section)"}

Bundle name: ${bundle.name}`;

    // --------------------------------------------------------
    // Claude call with tool loop
    // --------------------------------------------------------
    const messages = [
      ...historyMessages,
      { role: "user" as const, content: message },
    ];

    let finalResponse = "";
    let totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const t0 = Date.now();

    let currentMessages = messages;

    // Tool loop — max 5 iterations
    for (let iteration = 0; iteration < 5; iteration++) {
      const res = await fetch(ANTHROPIC_API, {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2048,
          system: [
            {
              type: "text",
              text: systemPrompt,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: TOOLS,
          messages: currentMessages,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Claude API error ${res.status}: ${body}`);
      }

      const data = await res.json();

      // Accumulate usage
      if (data.usage) {
        totalUsage.input_tokens += data.usage.input_tokens ?? 0;
        totalUsage.output_tokens += data.usage.output_tokens ?? 0;
        totalUsage.cache_read_input_tokens += data.usage.cache_read_input_tokens ?? 0;
        totalUsage.cache_creation_input_tokens += data.usage.cache_creation_input_tokens ?? 0;
      }

      if (data.stop_reason === "end_turn") {
        // Extract text from content blocks
        finalResponse = (data.content as { type: string; text?: string }[])
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");
        break;
      }

      if (data.stop_reason === "tool_use") {
        const assistantContent = data.content;
        const toolUseBlocks = (data.content as { type: string; id?: string; name?: string; input?: Record<string, unknown> }[])
          .filter((b) => b.type === "tool_use");

        // Execute all tools in parallel
        const toolResults = await Promise.all(
          toolUseBlocks.map(async (block) => ({
            type: "tool_result" as const,
            tool_use_id: block.id!,
            content: await executeTool(
              block.name!,
              (block.input ?? {}) as Record<string, unknown>,
              adminClient,
              userId,
              bundle_id
            ),
          }))
        );

        currentMessages = [
          ...currentMessages,
          { role: "assistant" as const, content: assistantContent },
          { role: "user" as const, content: toolResults },
        ];
        continue;
      }

      // Unexpected stop reason
      finalResponse = "Sorry, I couldn't complete that answer.";
      break;
    }

    const latencyMs = Date.now() - t0;

    // Save assistant response
    await adminClient.from("chat_messages").insert({
      user_id: userId,
      role: "assistant",
      content: finalResponse,
      scope_type: "bundle",
      scope_id: bundle_id,
    });

    await recordAiCall(adminClient, {
      user_id: userId,
      function_name: "ai-bundle-chat",
      model: MODEL,
      usage: totalUsage,
      latency_ms: latencyMs,
      source_type: "bundle",
      source_id: bundle_id,
    });

    return new Response(
      JSON.stringify({ role: "assistant", content: finalResponse }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[ai-bundle-chat] error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
