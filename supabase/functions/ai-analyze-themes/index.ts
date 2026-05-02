// ai-analyze-themes — on-demand thematic analysis across the user's
// accumulated corpus of ideas, memories, and outgoing commitments.
//
// This is the inverse of the existing per-cluster reports. Those run
// bottom-up: cluster similar ideas, generate a report per cluster. This
// runs top-down: read the WHOLE corpus holistically, find what's
// reverberating across meetings/people/accounts, surface the through-lines.
//
// The user will iterate on this prompt frequently. Bias the prompt toward
// specificity (named accounts, real quotes), against generic abstractions
// ("AI in marketing"), and against hedging. Each run is independent —
// prior reports are NOT fed back in. Theme decay is handled organically
// by recency in the corpus itself: if a theme stops reverberating, it
// drops out of the next analysis.
//
// Deploy: npm run deploy:functions -- ai-analyze-themes

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

const MODEL = "claude-opus-4-7";

// Corpus caps. With per-item semantic enrichment (top-K cross-corpus
// neighbors attached inline), each item runs ~400 tokens including its
// neighbor block. Caps at 700/300/700 = 1700 items × ~400 tokens fits
// comfortably under Opus 4.7's 1M context with room for the system
// prompt, adaptive thinking, and 64k output. The previous caps
// (300/200/200) were leaving 80%+ of the user's corpus unread; these
// raise coverage to about 40% while keeping prompt size predictable.
const MAX_IDEAS = 700;
const MAX_MEMORIES = 300;
const MAX_COMMITMENTS = 700;

// Semantic enrichment thresholds. Anything below MIN_NEIGHBOR_SIMILARITY
// is dropped — a "least-bad" neighbor at 0.4 is noise, not signal, and
// padding items with weak neighbors just costs tokens. Items with zero
// qualifying neighbors get no enrichment block at all (saves space).
const MIN_NEIGHBOR_SIMILARITY = 0.6;
const MAX_NEIGHBORS_PER_ITEM = 4;
// Concurrency for the find_similar RPC fan-out. Postgres will happily
// service the IVFFlat queries; the limit is just connection pool sanity.
const NEIGHBOR_FETCH_CONCURRENCY = 25;

interface IdeaRow {
  id: string;
  title: string;
  description: string | null;
  evidence_text: string | null;
  source_meeting_id: string | null;
  originated_by: string | null;
  company_name: string | null;
  category: string | null;
  status: string;
  created_at: string;
}

interface MemoryRow {
  id: string;
  content: string;
  source: string;
  created_at: string;
}

interface CommitmentRow {
  id: string;
  title: string;
  description: string | null;
  counterpart: string | null;
  company: string | null;
  do_by: string | null;
  status: string;
  evidence_text: string | null;
  source_meeting_id: string | null;
  created_at: string;
  direction: string;
}

interface MeetingMeta {
  id: string;
  title: string;
  start_time: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "unknown";
  return iso.substring(0, 10);
}

function daysAgo(iso: string | null): string {
  if (!iso) return "?";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "?";
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  return `${days}d ago`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SB_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    // Auth — accept user JWT or service role. Mirror the pattern from
    // ai-cluster-report so behavior is consistent across analytical fns.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isServiceRole = token === serviceRoleKey;

    let userId: string;
    if (isServiceRole) {
      const defaultUserId = Deno.env.get("RESURFACE_DEFAULT_USER_ID");
      if (!defaultUserId) {
        return new Response(
          JSON.stringify({ error: "RESURFACE_DEFAULT_USER_ID not set" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = defaultUserId;
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
    // Pull the corpus
    // ============================================================

    // Memories decay faster than ideas/commitments — they're soft facts about
    // people and relationships, and a memory from 6 months ago about an
    // attendee's role is often stale. Cap at 90 days to keep the corpus
    // weighted toward current reality. Older memories still surface via
    // semantic enrichment if they're related to a recent item.
    const memoryCutoffIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const [ideasRes, memoriesRes, commitmentsRes] = await Promise.all([
      adminClient
        .from("ideas")
        .select(
          "id, title, description, evidence_text, source_meeting_id, originated_by, company_name, category, status, quality, created_at"
        )
        .eq("user_id", userId)
        .neq("status", "dismissed")
        .neq("status", "archived")
        // Quality triage already exists (high/medium/low/null). Drop low —
        // those are parser noise: tactical minutiae, off-topic asides, weak
        // attributions. Untriaged (null) ideas stay in; medium and high
        // are obviously kept.
        .or("quality.neq.low,quality.is.null")
        .order("created_at", { ascending: false })
        .limit(MAX_IDEAS),
      adminClient
        .from("memories")
        .select("id, content, source, created_at")
        .eq("user_id", userId)
        .gte("created_at", memoryCutoffIso)
        .order("created_at", { ascending: false })
        .limit(MAX_MEMORIES),
      adminClient
        .from("commitments")
        .select(
          "id, title, description, counterpart, company, do_by, status, evidence_text, source_meeting_id, created_at, direction"
        )
        .eq("user_id", userId)
        .eq("direction", "outgoing")
        .order("created_at", { ascending: false })
        .limit(MAX_COMMITMENTS),
    ]);

    if (ideasRes.error) throw ideasRes.error;
    if (memoriesRes.error) throw memoriesRes.error;
    if (commitmentsRes.error) throw commitmentsRes.error;

    const ideas = (ideasRes.data ?? []) as IdeaRow[];
    const memories = (memoriesRes.data ?? []) as MemoryRow[];
    const commitments = (commitmentsRes.data ?? []) as CommitmentRow[];

    // ============================================================
    // Semantic enrichment — for each candidate, pull its top cross-corpus
    // neighbors via the find_similar RPC. The model gets these inline
    // alongside each item, so cross-table thematic bridges that used to
    // be implicit (the model had to find them via reasoning across the
    // whole corpus) are now explicit input. Saves the model thinking
    // budget for the part it's actually good at — naming what reverberates.
    //
    // We call find_similar in parallel batches. Cosine similarity below
    // MIN_NEIGHBOR_SIMILARITY is filtered out; an item with no
    // qualifying neighbors gets no enrichment block.
    // ============================================================

    interface Neighbor {
      table: string;
      title: string;
      similarity: number;
    }
    const neighborsByKey = new Map<string, Neighbor[]>();

    async function fetchNeighborsBatch(
      requests: Array<{ key: string; table: string; id: string }>,
    ) {
      await Promise.all(
        requests.map(async (req) => {
          try {
            const { data, error } = await adminClient.rpc("find_similar", {
              source_table: req.table,
              source_id: req.id,
              searching_user_id: userId,
              max_results: 8,
            });
            if (error || !data) return;
            const filtered: Neighbor[] = [];
            for (const row of data as Array<{
              result_table: string;
              title: string;
              similarity: number;
            }>) {
              if (row.similarity < MIN_NEIGHBOR_SIMILARITY) continue;
              filtered.push({
                table: row.result_table,
                title: row.title ?? "",
                similarity: row.similarity,
              });
              if (filtered.length >= MAX_NEIGHBORS_PER_ITEM) break;
            }
            if (filtered.length > 0) neighborsByKey.set(req.key, filtered);
          } catch {
            // A single neighbor-fetch failure is non-fatal — the item just
            // gets no enrichment block and the analysis proceeds.
          }
        }),
      );
    }

    const allNeighborRequests: Array<{ key: string; table: string; id: string }> = [
      ...ideas.map((i) => ({ key: `ideas:${i.id}`, table: "ideas", id: i.id })),
      ...memories.map((m) => ({ key: `memories:${m.id}`, table: "memories", id: m.id })),
      ...commitments.map((c) => ({ key: `commitments:${c.id}`, table: "commitments", id: c.id })),
    ];
    for (let offset = 0; offset < allNeighborRequests.length; offset += NEIGHBOR_FETCH_CONCURRENCY) {
      await fetchNeighborsBatch(allNeighborRequests.slice(offset, offset + NEIGHBOR_FETCH_CONCURRENCY));
    }

    function neighborBlock(key: string): string {
      const neighbors = neighborsByKey.get(key);
      if (!neighbors || neighbors.length === 0) return "";
      const lines = neighbors
        .map((n) => `       · ${n.table}: "${n.title}" (${(n.similarity * 100).toFixed(0)}%)`)
        .join("\n");
      return `\n     near:\n${lines}`;
    }

    // Pull meeting metadata for any items that reference a meeting, so
    // the AI can ground its evidence in real meeting titles/dates rather
    // than UUIDs. One round trip for the whole corpus.
    const meetingIds = new Set<string>();
    for (const i of ideas) if (i.source_meeting_id) meetingIds.add(i.source_meeting_id);
    for (const c of commitments) if (c.source_meeting_id) meetingIds.add(c.source_meeting_id);

    const meetingsById = new Map<string, MeetingMeta>();
    if (meetingIds.size > 0) {
      const { data: meetingRows } = await adminClient
        .from("meetings")
        .select("id, title, start_time")
        .in("id", [...meetingIds]);
      for (const m of (meetingRows ?? []) as MeetingMeta[]) {
        meetingsById.set(m.id, m);
      }
    }

    // ============================================================
    // Build the corpus block
    // ============================================================

    const ideaLines = ideas.map((i) => {
      const m = i.source_meeting_id ? meetingsById.get(i.source_meeting_id) : null;
      const meetingPart = m ? ` | meeting: "${m.title}" (${fmtDate(m.start_time)})` : "";
      const originator = i.originated_by ? ` | said by: ${i.originated_by}` : "";
      const company = i.company_name ? ` | company: ${i.company_name}` : "";
      const cat = i.category ? ` | category: ${i.category}` : "";
      const desc = i.description ? `\n     description: ${i.description}` : "";
      const ev = i.evidence_text ? `\n     evidence: "${i.evidence_text}"` : "";
      return (
        `   - [idea ${i.id}] (${daysAgo(i.created_at)})${originator}${company}${meetingPart}${cat}\n` +
        `     title: ${i.title}${desc}${ev}${neighborBlock(`ideas:${i.id}`)}`
      );
    }).join("\n");

    const memoryLines = memories.map((m) => {
      return (
        `   - [memory ${m.id}] (${daysAgo(m.created_at)}) source: ${m.source}\n` +
        `     ${m.content}${neighborBlock(`memories:${m.id}`)}`
      );
    }).join("\n");

    const commitmentLines = commitments.map((c) => {
      const m = c.source_meeting_id ? meetingsById.get(c.source_meeting_id) : null;
      const meetingPart = m ? ` | meeting: "${m.title}" (${fmtDate(m.start_time)})` : "";
      const cp = c.counterpart ? ` | to: ${c.counterpart}` : "";
      const company = c.company ? ` | company: ${c.company}` : "";
      const due = c.do_by ? ` | do_by: ${c.do_by}` : "";
      const desc = c.description ? `\n     description: ${c.description}` : "";
      const ev = c.evidence_text ? `\n     evidence: "${c.evidence_text}"` : "";
      return (
        `   - [commitment ${c.id}] (${daysAgo(c.created_at)}) status: ${c.status}${cp}${company}${meetingPart}${due}\n` +
        `     title: ${c.title}${desc}${ev}${neighborBlock(`commitments:${c.id}`)}`
      );
    }).join("\n");

    const corpusBlock = `
Today's date: ${new Date().toISOString().substring(0, 10)}

IDEAS (${ideas.length})
${ideaLines || "  (none)"}

MEMORIES (${memories.length})
${memoryLines || "  (none)"}

OUTGOING COMMITMENTS (${commitments.length})
${commitmentLines || "  (none)"}
`.trim();

    // ============================================================
    // Build prompts
    // ============================================================

    const systemPrompt = `You are a senior strategic analyst reading the accumulated body of a Content GTM lead's work over the last several months. You see what they've been thinking about (ideas), what they've been told and chosen to remember (memories), and what they've promised to deliver to other people (outgoing commitments).

Your job is to find what reverberates. Not what's frequent — what matters. A theme is a pattern that recurs across multiple sources, multiple people, multiple contexts, in a way that suggests something is trying to surface. It doesn't matter who articulated it. If three different external clients independently raise the same concern, that's a louder signal than the user articulating it themselves once. If the user keeps coming back to an idea across six weeks of meetings, that's also signal even if no one else mentions it.

Weight recent material heavily. Items from the last 21 days are primary evidence — those are what's actively reverberating. Items 22-60 days old are supporting context. Items older than 60 days should anchor a theme only when the same idea is also surfacing in recent material; a theme made entirely of 60+ day old items is a stale pattern, and you should either drop it or call it out explicitly as a theme that's gone quiet but might be worth revisiting. Use the "(Nd ago)" tag on each corpus item to assess this directly. Recency dominates, but doesn't completely override: an unclaimed idea from 90 days ago that's reappearing in this week's meetings is more important than three from this week that nobody has touched again.

Many corpus items come with a "near:" block listing their semantic neighbors across all four corpus tables (ideas, memories, commitments, meetings) along with a similarity percentage. Treat these neighbor lists as evidence of cross-corpus reverberation: when an idea's neighbors include memories of clients saying similar things and commitments to act on the same domain, that's a stronger pattern than the idea standing alone. Items without a "near:" block are semantically isolated — that doesn't disqualify them, but isolation is itself a signal worth noting.

WRITE LIKE THIS:
- Sharp, specific, in plain English the user would actually say.
- Named accounts, named people, real quote evidence — not categories or abstractions.
- Take positions. If you're wrong, the user dismisses the theme. That's fine. Generic themes that are technically defensible are worse than confident calls that turn out off-base.

DO NOT:
- Produce themes that could apply to any GTM consultant. If a different consultant working a different book of clients could have generated the same theme, it's too generic. Reject it.
- Hedge. No "might suggest", "could indicate", "appears to potentially". Make claims.
- Manufacture themes to hit a count. As many or as few as the corpus warrants. If nothing is reverberating yet, say so plainly. One sharp theme beats four padded ones.
- Use any of these tells: "delve", "leverage", "robust", "seamless", "navigate" as a verb, "ensure", "moreover". No em dashes. No colon-punchlines ("Here's the thing: it works"). No triadic rhetorical lists.

OUTPUT FORMAT (strict JSON, nothing else, no markdown fence):

{
  "intro": "Optional one-paragraph framing — where the user is right now looking at the whole picture. Can be empty string if the corpus is too thin to frame.",
  "themes": [
    {
      "title": "One-line claim, sharp and specific. Names accounts/people if relevant.",
      "evidence": [
        {
          "source_type": "idea" | "memory" | "commitment",
          "source_id": "the UUID from the corpus",
          "meeting_title": "the meeting it came from, or empty string if no source meeting",
          "meeting_date": "REQUIRED. YYYY-MM-DD format. Pull from the corpus item's meeting context or the item's own (Nd ago) tag converted to a real date. Do NOT leave this empty — if you can't determine a date, don't use the item as evidence. The date is how the user judges whether evidence is current or stale, so it's load-bearing.",
          "quote": "the actual evidence text or quote — keep verbatim where possible",
          "person": "name of the person, or empty string if unknown/N-A",
          "company": "company name, or empty string if N/A"
        }
      ],
      "why_it_matters": "Specific value claim. What's available, what changes if the user acts. Not platitudes.",
      "next_move": "A single concrete action the user could take this week. Specific person, specific meeting, specific deliverable. Not 'consider exploring further'."
    }
  ],
  "one_offs": [
    {
      "signal": "The single sharp thing you noticed.",
      "source_type": "idea" | "memory" | "commitment",
      "source_id": "the UUID",
      "meeting_title": "...",
      "meeting_date": "YYYY-MM-DD",
      "why_watch": "Why this could become a theme if it surfaces again. One sentence."
    }
  ]
}

Themes have at least 2 evidence items. One-offs have exactly 1. If something has only one source, it goes in one_offs not themes.`;

    const userMessage = `Here is the corpus. Analyze it. Return JSON only.\n\n${corpusBlock}`;

    // ============================================================
    // Insert stub row, return it to the caller, run AI in background
    // ============================================================
    //
    // Opus 4.7 with adaptive thinking on a real corpus can run 90s+;
    // the Supabase Edge Function gateway times out before that and
    // returns 504 even though the function itself can keep running.
    // To survive: insert a generating-state row, return it immediately,
    // do the heavy work in EdgeRuntime.waitUntil, and update the row
    // when ready. The client polls this row's status.

    const { data: stub, error: stubErr } = await adminClient
      .from("theme_reports")
      .insert({
        user_id: userId,
        report_type: "general",
        status: "generating",
        themes: [],
        one_offs: [],
        model: MODEL,
      })
      .select()
      .single();

    if (stubErr || !stub) {
      console.error("[ai-analyze-themes] failed to insert stub row:", stubErr);
      return new Response(
        JSON.stringify({ error: "Failed to insert stub", detail: stubErr?.message ?? "unknown" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const reportId = stub.id;

    const backgroundWork = (async () => {
      const claudeStart = Date.now();
      try {
        const result = await runAnalysisAndPersist({
          adminClient,
          anthropicKey,
          systemPrompt,
          userMessage,
          reportId,
          ideas,
          memories,
          commitments,
          neighborsCount: neighborsByKey.size,
          claudeStart,
        });
        if (!result.ok) {
          await adminClient
            .from("theme_reports")
            .update({
              status: "failed",
              error_text: result.error,
              input_summary: {
                ideas_count: ideas.length,
                memories_count: memories.length,
                commitments_count: commitments.length,
                enriched_items: neighborsByKey.size,
                claude_ms: Date.now() - claudeStart,
                stage: result.stage,
              },
            })
            .eq("id", reportId);
        }
      } catch (err) {
        console.error("[ai-analyze-themes] background error:", err);
        await adminClient
          .from("theme_reports")
          .update({
            status: "failed",
            error_text: err instanceof Error ? err.message : String(err),
          })
          .eq("id", reportId);
      }
    })();

    // deno-lint-ignore no-explicit-any
    const er = (globalThis as any).EdgeRuntime;
    if (er && typeof er.waitUntil === "function") {
      er.waitUntil(backgroundWork);
    }

    return new Response(
      JSON.stringify({ ok: true, report: stub }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[ai-analyze-themes] error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================================
// Background analysis runner. Calls Claude, parses output, updates
// the report row in place. Returns a result discriminator so the
// caller can write a useful error_text on failure.
// ============================================================

async function runAnalysisAndPersist(opts: {
  adminClient: ReturnType<typeof createClient>;
  anthropicKey: string;
  systemPrompt: string;
  userMessage: string;
  reportId: string;
  ideas: IdeaRow[];
  memories: MemoryRow[];
  commitments: CommitmentRow[];
  neighborsCount: number;
  claudeStart: number;
}): Promise<
  | { ok: true }
  | { ok: false; stage: "claude_http" | "claude_stream" | "json_parse" | "update_row"; error: string }
> {
  const { adminClient, anthropicKey, systemPrompt, userMessage, reportId, ideas, memories, commitments, neighborsCount, claudeStart } = opts;

  // Set max_tokens to the model ceiling. Adaptive thinking and the
  // structured-JSON output share the budget; the model has no reason
  // to use tokens it doesn't need, so making the cap big can't hurt
  // throughput, only un-cap correctness. Above ~21k tokens Anthropic
  // requires streaming, so we use SSE and collect the chunks server-
  // side.
  const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        stream: true,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

  if (!aiResp.ok || !aiResp.body) {
    const errText = await aiResp.text();
    console.error("[ai-analyze-themes] Claude API error:", errText);
    return { ok: false, stage: "claude_http", error: errText.substring(0, 1000) };
  }

  // Parse the SSE stream. We accumulate text deltas from text blocks
  // (ignoring thinking-delta blocks — those are reasoning, not the
  // output JSON we need to parse), and grab the final usage from
  // message_delta or message_start events.
  const reader = aiResp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let textBlocks = "";
  let usage: Record<string, number> | null = null;
  let stopReason: string | null = null;
  let currentBlockType: string | null = null;
  let streamErr: { type?: string; message?: string } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "content_block_start") {
          currentBlockType = ev.content_block?.type ?? null;
        } else if (ev.type === "content_block_delta") {
          if (currentBlockType === "text" && ev.delta?.type === "text_delta") {
            textBlocks += ev.delta.text ?? "";
          }
        } else if (ev.type === "content_block_stop") {
          currentBlockType = null;
        } else if (ev.type === "message_start") {
          usage = ev.message?.usage ?? null;
        } else if (ev.type === "message_delta") {
          if (ev.usage) usage = { ...(usage ?? {}), ...ev.usage };
          if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        } else if (ev.type === "error") {
          streamErr = ev.error ?? { message: "stream error" };
        }
      } catch {
        // Malformed payload — skip rather than fail the whole stream.
      }
    }
  }

  if (streamErr) {
    console.error("[ai-analyze-themes] stream error:", streamErr);
    return { ok: false, stage: "claude_stream", error: streamErr.message ?? "unknown" };
  }

  const claudeMs = Date.now() - claudeStart;
  if (stopReason && stopReason !== "end_turn") {
    console.warn(`[ai-analyze-themes] stop_reason=${stopReason} (output may be incomplete)`);
  }

  let parsed: { intro?: string; themes?: unknown[]; one_offs?: unknown[] };
  try {
    const cleaned = textBlocks.replace(/^```(?:json)?\s*\n?|\n?```\s*$/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (parseErr) {
    console.error("[ai-analyze-themes] JSON parse failed:", parseErr, "raw:", textBlocks.substring(0, 500));
    return { ok: false, stage: "json_parse", error: textBlocks.substring(0, 1000) };
  }

  const inputSummary = {
    ideas_count: ideas.length,
    memories_count: memories.length,
    commitments_count: commitments.length,
    enriched_items: neighborsCount,
    claude_ms: claudeMs,
    usage,
    stop_reason: stopReason,
  };

  const { error: updateErr } = await adminClient
    .from("theme_reports")
    .update({
      status: "ready",
      intro: parsed.intro ?? null,
      themes: parsed.themes ?? [],
      one_offs: parsed.one_offs ?? [],
      input_summary: inputSummary,
      error_text: null,
    })
    .eq("id", reportId);

  if (updateErr) {
    console.error("[ai-analyze-themes] update error:", updateErr);
    return { ok: false, stage: "update_row", error: updateErr.message };
  }

  return { ok: true };
}
