import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import { recordAiCall } from "../_shared/telemetry.ts";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-7";

// EdgeRuntime.waitUntil exists in Supabase's Deno runtime
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

// ============================================================
// Pass 1: cross-reference + priority ranking (returns JSON)
// ============================================================

const PASS1_SYSTEM = `You cross-reference event briefings against a user's work history database.
You will be required to call the return_rankings tool with the structured result — do not respond in free text.`;

const PASS1_USER_TEMPLATE = (bundleName: string, briefing: string, catalog: string) => `
Event: ${bundleName}

BRIEFING (who is at the event, what is scheduled):
${briefing}

RESURFACE CATALOG (meeting history, commitments, pursuits — with UUIDs):
${catalog}

Cross-reference every person and company in the briefing against the Resurface catalog.
Use fuzzy matching: abbreviations ("WK" = "Wolters Kluwer"), partial names, related entities.

Rules:
- PRIORITY = has Resurface history OR has a scheduled 1:1/meal/event touchpoint at Summit
- WARM = Resurface history exists but no specific Summit touchpoint
- COLD = no Resurface history, no scheduled touchpoint
- Include every named person and company from the briefing in one of the three buckets
- matched_meeting_ids: only include IDs that clearly match — no guessing; empty array if no match

Call the return_rankings tool with your answer.`;

// ============================================================
// Pass 2: write the full deep report
// ============================================================

const PASS2_SYSTEM = `You are writing a detailed pre-event engagement briefing for Dustin Collis,
Head of Adobe Practice NA at EPAM Systems, attending Adobe Summit 2026 in Las Vegas (April 19-22).

Write for someone reading on a phone on a plane. Scannable, not walls of text.
Cite every fact as [Briefing] or [Resurface]. Never fabricate.`;

const PASS2_USER_TEMPLATE = (
  bundleName: string,
  priorityBlocks: string,
  warmList: string,
  coldList: string,
  schedule: string,
  gaps: string
) => `
Event: ${bundleName}

You have already completed a cross-reference pass. Here are the results with full Resurface context:

${priorityBlocks}

---
WARM CONTACTS (relationship exists, no immediate action needed):
${warmList || "None identified."}

---
COLD CONTACTS (no history, no scheduled touchpoint — for awareness only):
${coldList || "None."}

---
SCHEDULE CONTEXT:
${schedule}

---
OPEN GAPS:
${gaps || "None."}

---
Now write the full engagement briefing report. Structure:

# [Event Name] — Engagement Briefing

## Executive Summary
5 bullets. Most important things before landing. Be specific — name names, cite signals.

## Priority Accounts
One section per priority account. For each, write:
**[Account Name]**
- **Why priority:** [signals]
- **Resurface history:** [what transcripts/commitments actually show — specific topics, promises, context]
- **At this event:** [who to find, when, where]
- **Your move:** [specific ask or action — not generic]

## Warm Contacts
One line each. Name, why warm, one suggested action if any.

## Cold Contacts — Awareness Only
Compact table: Company | Key Contact | Briefing signal

## Schedule
Day-by-day with conflicts called out.

## Messaging & Talking Points
By offering. Only relevant to the priority accounts above.

## Open Gaps & Decisions Needed

## Quick Reference
Key names, times, locations — the things you look up in a hurry.`;

// ============================================================
// Resurface catalog loader (includes IDs + summaries for matching)
// ============================================================
async function loadResurfaceCatalog(
  adminClient: ReturnType<typeof createClient>,
  userId: string
): Promise<string> {
  const [meetingsRes, commitmentsRes, pursuitsRes, memoriesRes] = await Promise.all([
    adminClient
      .from("meetings")
      .select("id, title, start_time, attendees, transcript_summary")
      .eq("user_id", userId)
      .order("start_time", { ascending: false })
      .limit(300),
    adminClient
      .from("commitments")
      .select("id, title, counterpart, company, status, direction, do_by")
      .eq("user_id", userId)
      .neq("status", "met")
      .limit(100),
    adminClient
      .from("pursuits")
      .select("id, name, company, status, stage")
      .eq("user_id", userId)
      .neq("status", "archived")
      .limit(50),
    adminClient
      .from("memories")
      .select("content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const parts: string[] = [];

  const meetings = meetingsRes.data ?? [];
  if (meetings.length > 0) {
    parts.push(
      `## MEETINGS (${meetings.length}) — include IDs in matched_meeting_ids when they match\n` +
        meetings
          .map((m) => {
            const att = Array.isArray(m.attendees) && m.attendees.length
              ? ` | Attendees: ${(m.attendees as string[]).slice(0, 10).join(", ")}`
              : "";
            const summary = m.transcript_summary
              ? ` | Summary: ${String(m.transcript_summary).slice(0, 200)}`
              : "";
            return `[ID:${m.id}] "${m.title}" (${m.start_time?.slice(0, 10) ?? "no date"})${att}${summary}`;
          })
          .join("\n")
    );
  }

  const commitments = commitmentsRes.data ?? [];
  if (commitments.length > 0) {
    parts.push(
      `## COMMITMENTS (${commitments.length})\n` +
        commitments
          .map(
            (c) =>
              `[ID:${c.id}] [${c.direction}] "${c.title}"${c.counterpart ? ` | Person: ${c.counterpart}` : ""}${c.company ? ` | Company: ${c.company}` : ""} | Status: ${c.status}${c.do_by ? ` | Due: ${c.do_by}` : ""}`
          )
          .join("\n")
    );
  }

  const pursuits = pursuitsRes.data ?? [];
  if (pursuits.length > 0) {
    parts.push(
      `## PURSUITS (${pursuits.length})\n` +
        pursuits
          .map(
            (p) =>
              `[ID:${p.id}] "${p.name}"${p.company ? ` | Company: ${p.company}` : ""} | ${p.stage ?? p.status}`
          )
          .join("\n")
    );
  }

  const memories = memoriesRes.data ?? [];
  if (memories.length > 0) {
    parts.push(
      `## MEMORIES\n` + memories.map((m) => `- ${m.content}`).join("\n")
    );
  }

  return parts.length > 0 ? parts.join("\n\n") : "No Resurface data found.";
}

// ============================================================
// Transcript chunk loader (pass 2 enrichment)
// ============================================================
async function loadMeetingChunks(
  adminClient: ReturnType<typeof createClient>,
  meetingIds: string[],
  maxChunksPerMeeting = 6
): Promise<Map<string, string>> {
  if (meetingIds.length === 0) return new Map();

  const result = new Map<string, string>();
  const BATCH = 10;
  for (let i = 0; i < meetingIds.length; i += BATCH) {
    const batch = meetingIds.slice(i, i + BATCH);
    const { data: chunks } = await adminClient
      .from("meeting_chunks")
      .select("meeting_id, topic_label, chunk_text")
      .in("meeting_id", batch)
      .order("chunk_index");

    for (const chunk of chunks ?? []) {
      const existing = result.get(chunk.meeting_id) ?? "";
      const count = (existing.match(/\[Topic:/g) ?? []).length;
      if (count >= maxChunksPerMeeting) continue;
      result.set(
        chunk.meeting_id,
        existing + `[Topic: ${chunk.topic_label}]\n${chunk.chunk_text}\n\n`
      );
    }
  }

  return result;
}

// ============================================================
// Claude callers — free text (Pass 2) and forced tool use (Pass 1)
// ============================================================
async function callClaude(
  anthropicKey: string,
  system: string,
  userContent: string,
  maxTokens: number,
  useThinking = false
): Promise<{ text: string; usage: Record<string, number> }> {
  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
  };
  if (useThinking) body.thinking = { type: "adaptive" };

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = (data.content as { type: string; text?: string }[])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

  return { text, usage: data.usage ?? {} };
}

// Forces Claude to return structured data by requiring a specific tool_use call.
// The API validates the input against the provided JSON schema — the response
// cannot be malformed. Returns the parsed input object directly.
async function callClaudeWithTool<T>(
  anthropicKey: string,
  system: string,
  userContent: string,
  toolName: string,
  toolDescription: string,
  inputSchema: Record<string, unknown>,
  maxTokens: number
): Promise<{ input: T; usage: Record<string, number> }> {
  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: [
      {
        name: toolName,
        description: toolDescription,
        input_schema: inputSchema,
      },
    ],
    tool_choice: { type: "tool", name: toolName },
    messages: [{ role: "user", content: userContent }],
  };

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const toolBlock = (data.content as { type: string; name?: string; input?: unknown }[])
    .find((b) => b.type === "tool_use" && b.name === toolName);

  if (!toolBlock || typeof toolBlock.input !== "object") {
    throw new Error(`Expected tool_use block '${toolName}' not found in response`);
  }

  return { input: toolBlock.input as T, usage: data.usage ?? {} };
}

// ============================================================
// Background worker — runs after the HTTP response returns
// ============================================================
async function generateReport(
  adminClient: ReturnType<typeof createClient>,
  anthropicKey: string,
  userId: string,
  bundleId: string,
  bundleName: string
) {
  const t0 = Date.now();
  const totalUsage: Record<string, number> = {};

  try {
    const [docsRes, gapsRes, catalog] = await Promise.all([
      adminClient
        .from("bundle_documents")
        .select("title, content_md, position")
        .eq("bundle_id", bundleId)
        .order("position"),
      adminClient
        .from("bundle_gaps")
        .select("content, state")
        .eq("bundle_id", bundleId)
        .order("position"),
      loadResurfaceCatalog(adminClient, userId),
    ]);

    if (!docsRes.data || docsRes.data.length === 0) {
      throw new Error("No documents found in bundle");
    }

    const briefingText = docsRes.data
      .map((d) => `# ${d.title}\n\n${d.content_md}`)
      .join("\n\n---\n\n");

    const gapsText = (gapsRes.data ?? [])
      .map((g) => `- ${g.content}`)
      .join("\n");

    // ── Pass 1: forced tool use — API validates schema, no parsing needed ──
    type Rankings = {
      priority: {
        display_name: string;
        type: string;
        signals: string[];
        matched_meeting_ids: string[];
        matched_commitment_ids: string[];
        matched_pursuit_ids: string[];
        briefing_context: string;
        resurface_summary: string;
      }[];
      warm: {
        display_name: string;
        type: string;
        matched_meeting_ids: string[];
        resurface_summary: string;
      }[];
      cold: string[];
    };

    const rankingsSchema = {
      type: "object",
      required: ["priority", "warm", "cold"],
      properties: {
        priority: {
          type: "array",
          description: "Accounts with Resurface history OR a scheduled touchpoint at the event. Max 20.",
          items: {
            type: "object",
            required: [
              "display_name",
              "type",
              "signals",
              "matched_meeting_ids",
              "matched_commitment_ids",
              "matched_pursuit_ids",
              "briefing_context",
              "resurface_summary",
            ],
            properties: {
              display_name: { type: "string", description: "Name as it appears in the briefing" },
              type: { type: "string", enum: ["company", "person"] },
              signals: {
                type: "array",
                items: { type: "string" },
                description: "Why this is priority — e.g. 'BASH bus', 'Monday dinner', 'prior meeting'",
              },
              matched_meeting_ids: {
                type: "array",
                items: { type: "string" },
                description: "UUIDs from the MEETINGS catalog. Only include clear matches. Empty array if none.",
              },
              matched_commitment_ids: { type: "array", items: { type: "string" } },
              matched_pursuit_ids: { type: "array", items: { type: "string" } },
              briefing_context: {
                type: "string",
                description: "Key facts from the briefing: who to find, when/where, why they matter",
              },
              resurface_summary: {
                type: "string",
                description: "What Resurface shows: meeting titles, dates, key topics, open items. 'No history' if none.",
              },
            },
          },
        },
        warm: {
          type: "array",
          description: "Resurface history exists but no scheduled touchpoint. Max 25.",
          items: {
            type: "object",
            required: ["display_name", "type", "matched_meeting_ids", "resurface_summary"],
            properties: {
              display_name: { type: "string" },
              type: { type: "string", enum: ["company", "person"] },
              matched_meeting_ids: { type: "array", items: { type: "string" } },
              resurface_summary: { type: "string" },
            },
          },
        },
        cold: {
          type: "array",
          description: "No history, no touchpoint. Max 40 names.",
          items: { type: "string" },
        },
      },
    };

    console.log("[report] Pass 1: cross-referencing via tool use...");
    const pass1 = await callClaudeWithTool<Rankings>(
      anthropicKey,
      PASS1_SYSTEM,
      PASS1_USER_TEMPLATE(bundleName, briefingText, catalog),
      "return_rankings",
      "Return the cross-reference rankings for every person and company in the briefing",
      rankingsSchema,
      8192
    );
    for (const [k, v] of Object.entries(pass1.usage)) {
      totalUsage[k] = (totalUsage[k] ?? 0) + (v as number);
    }
    const rankings = pass1.input;

    console.log(
      `[report] Pass 1 done: ${rankings.priority.length} priority, ${rankings.warm.length} warm, ${(rankings.cold ?? []).length} cold`
    );

    // ── Load transcript chunks for matched meetings ───────
    const allMatchedMeetingIds = [
      ...rankings.priority.flatMap((p) => p.matched_meeting_ids ?? []),
      ...rankings.warm.flatMap((w) => w.matched_meeting_ids ?? []),
    ].filter(Boolean);
    const uniqueMeetingIds = [...new Set(allMatchedMeetingIds)];
    console.log(`[report] Loading chunks for ${uniqueMeetingIds.length} meetings...`);

    const chunksByMeeting = await loadMeetingChunks(adminClient, uniqueMeetingIds, 6);

    const meetingTitles = new Map<string, string>();
    if (uniqueMeetingIds.length > 0) {
      const { data: meetingRows } = await adminClient
        .from("meetings")
        .select("id, title, start_time")
        .in("id", uniqueMeetingIds);
      for (const m of meetingRows ?? []) {
        meetingTitles.set(m.id, `${m.title} (${m.start_time?.slice(0, 10) ?? ""})`);
      }
    }

    // ── Build enriched priority blocks for Pass 2 ─────────
    const priorityBlocks = rankings.priority
      .map((account) => {
        const meetingContent = (account.matched_meeting_ids ?? [])
          .map((id) => {
            const chunks = chunksByMeeting.get(id);
            if (!chunks) return null;
            const title = meetingTitles.get(id) ?? id;
            return `  Meeting: ${title}\n${chunks
              .split("\n")
              .map((l) => `    ${l}`)
              .join("\n")}`;
          })
          .filter(Boolean)
          .join("\n\n");

        return [
          `### ${account.display_name} (${account.type})`,
          `**Signals:** ${(account.signals ?? []).join(", ")}`,
          `**Briefing:** ${account.briefing_context}`,
          `**Resurface summary:** ${account.resurface_summary}`,
          meetingContent
            ? `**Transcript excerpts:**\n${meetingContent}`
            : "**Transcript excerpts:** None — no matched meetings in Resurface.",
        ].join("\n");
      })
      .join("\n\n---\n\n");

    const warmList = rankings.warm
      .map((w) => `- **${w.display_name}**: ${w.resurface_summary}`)
      .join("\n");

    const coldList = (rankings.cold ?? []).join(", ");

    // ── Pass 2 ─────────────────────────────────────────────
    console.log("[report] Pass 2: writing full report...");
    const pass2 = await callClaude(
      anthropicKey,
      PASS2_SYSTEM,
      PASS2_USER_TEMPLATE(bundleName, priorityBlocks, warmList, coldList, briefingText, gapsText),
      8192,
      true
    );
    for (const [k, v] of Object.entries(pass2.usage)) {
      totalUsage[k] = (totalUsage[k] ?? 0) + (v as number);
    }

    const latencyMs = Date.now() - t0;
    const reportText = pass2.text;

    // ── Save report + flip status ─────────────────────────
    await adminClient.from("bundle_reports").delete().eq("bundle_id", bundleId);
    const { error: saveError } = await adminClient
      .from("bundle_reports")
      .insert({
        bundle_id: bundleId,
        content_md: reportText,
        model: MODEL,
        generated_at: new Date().toISOString(),
      });
    if (saveError) throw new Error(`Failed to save report: ${saveError.message}`);

    await adminClient
      .from("bundles")
      .update({
        report_status: "ready",
        report_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bundleId);

    await recordAiCall(adminClient, {
      user_id: userId,
      function_name: "ai-bundle-report",
      model: MODEL,
      usage: totalUsage,
      latency_ms: latencyMs,
      source_type: "bundle",
      source_id: bundleId,
      metadata: {
        passes: 2,
        priority_accounts: rankings.priority.length,
        warm_accounts: rankings.warm.length,
        cold_accounts: (rankings.cold ?? []).length,
        matched_meetings: uniqueMeetingIds.length,
      },
    });

    console.log(`[report] Done in ${latencyMs}ms`);
  } catch (err) {
    console.error("[ai-bundle-report] background error:", err);
    await adminClient
      .from("bundles")
      .update({
        report_status: "failed",
        report_error: String(err).slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", bundleId);
  }
}

// ============================================================
// HTTP handler — returns 202 immediately, work continues in bg
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

    const { bundle_id } = await req.json() as { bundle_id: string };
    if (!bundle_id) {
      return new Response(JSON.stringify({ error: "bundle_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: bundle } = await adminClient
      .from("bundles")
      .select("id, name, status, report_status")
      .eq("id", bundle_id)
      .eq("user_id", user.id)
      .single();

    if (!bundle) {
      return new Response(JSON.stringify({ error: "Bundle not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (bundle.status !== "ready") {
      return new Response(
        JSON.stringify({ error: "Bundle must be ingested before generating a report" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (bundle.report_status === "generating") {
      return new Response(
        JSON.stringify({ ok: true, status: "generating", already_running: true }),
        { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark as generating and return 202 immediately
    await adminClient
      .from("bundles")
      .update({
        report_status: "generating",
        report_error: null,
        report_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", bundle_id);

    // Kick off background work — function returns without awaiting
    EdgeRuntime.waitUntil(
      generateReport(adminClient, anthropicKey, user.id, bundle_id, bundle.name)
    );

    return new Response(
      JSON.stringify({ ok: true, status: "generating" }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[ai-bundle-report] handler error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
