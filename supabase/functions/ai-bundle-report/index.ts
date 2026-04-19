import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import { recordAiCall } from "../_shared/telemetry.ts";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-7";

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

// ============================================================
// STAGE 1 — Read pre-extracted entities from bundle_entities
// (ingest already ran entity extraction and stored the results;
//  no need to re-run it at report time)
// ============================================================

interface ExtractedEntity {
  name: string;
  type: "person" | "company";
}

// ============================================================
// STAGE 2 — Per-entity deterministic lookup (SQL, parallel)
// ============================================================

interface MeetingRow {
  id: string;
  title: string;
  start_time: string | null;
  attendees: string[] | null;
  transcript_summary: string | null;
}
interface ChunkRow {
  meeting_id: string;
  topic_label: string | null;
  chunk_text: string;
  speakers: string[] | null;
}
interface CommitmentRow {
  title: string;
  counterpart: string | null;
  company: string | null;
  status: string;
  direction: string;
  do_by: string | null;
}
interface PursuitRow {
  name: string;
  company: string | null;
  status: string;
  stage: string | null;
}
interface MemoryRow {
  content: string;
  created_at: string;
}

interface EntityDossier {
  entity: ExtractedEntity;
  meetings: MeetingRow[];
  chunks: ChunkRow[];
  commitments: CommitmentRow[];
  pursuits: PursuitRow[];
  memories: MemoryRow[];
  totalHits: number;
}

// Escape a name for safe use inside a PostgREST .or() filter value.
// PostgREST parses commas and parens in .or() so we strip them; the
// name also can't contain unescaped %.
function safeForFilter(name: string): string {
  return name.replace(/[%(),]/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchEntityDossier(
  entity: ExtractedEntity,
  adminClient: ReturnType<typeof createClient>,
  userId: string
): Promise<EntityDossier> {
  const safe = safeForFilter(entity.name);
  const pattern = `%${safe}%`;
  const isPerson = entity.type === "person";

  // Meetings: match on title (trigram-indexed), plus attendees array contains
  // the exact name for person entities.
  const meetingsQuery = isPerson
    ? adminClient
        .from("meetings")
        .select("id, title, start_time, attendees, transcript_summary")
        .eq("user_id", userId)
        .or(`title.ilike.${pattern},attendees.cs.{"${safe}"}`)
        .order("start_time", { ascending: false })
        .limit(10)
    : adminClient
        .from("meetings")
        .select("id, title, start_time, attendees, transcript_summary")
        .eq("user_id", userId)
        .ilike("title", pattern)
        .order("start_time", { ascending: false })
        .limit(10);

  const [meetingsRes, chunksRes, commitmentsRes, pursuitsRes, memoriesRes] =
    await Promise.all([
      meetingsQuery,
      adminClient
        .from("meeting_chunks")
        .select("meeting_id, topic_label, chunk_text, speakers")
        .eq("user_id", userId)
        .ilike("chunk_text", pattern)
        .limit(8),
      isPerson
        ? adminClient
            .from("commitments")
            .select("title, counterpart, company, status, direction, do_by")
            .eq("user_id", userId)
            .ilike("counterpart", pattern)
            .limit(10)
        : adminClient
            .from("commitments")
            .select("title, counterpart, company, status, direction, do_by")
            .eq("user_id", userId)
            .ilike("company", pattern)
            .limit(10),
      isPerson
        ? Promise.resolve({ data: [] as PursuitRow[] })
        : adminClient
            .from("pursuits")
            .select("name, company, status, stage")
            .eq("user_id", userId)
            .ilike("company", pattern)
            .limit(5),
      adminClient
        .from("memories")
        .select("content, created_at")
        .eq("user_id", userId)
        .ilike("content", pattern)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const meetings = (meetingsRes.data ?? []) as MeetingRow[];
  const chunks = (chunksRes.data ?? []) as ChunkRow[];
  const commitments = (commitmentsRes.data ?? []) as CommitmentRow[];
  const pursuits = (pursuitsRes.data ?? []) as PursuitRow[];
  const memories = (memoriesRes.data ?? []) as MemoryRow[];

  return {
    entity,
    meetings,
    chunks,
    commitments,
    pursuits,
    memories,
    totalHits:
      meetings.length +
      chunks.length +
      commitments.length +
      pursuits.length +
      memories.length,
  };
}

async function buildAllDossiers(
  entities: ExtractedEntity[],
  adminClient: ReturnType<typeof createClient>,
  userId: string
): Promise<EntityDossier[]> {
  const CONCURRENCY = 8;
  const results: EntityDossier[] = [];
  for (let i = 0; i < entities.length; i += CONCURRENCY) {
    const batch = entities.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((e) => fetchEntityDossier(e, adminClient, userId))
    );
    results.push(...batchResults);
  }
  return results;
}

// ============================================================
// STAGE 3 — Format dossiers as markdown for synthesis input
// ============================================================

function formatDossier(d: EntityDossier): string {
  const parts: string[] = [];
  parts.push(`### ${d.entity.name} (${d.entity.type})`);

  if (d.meetings.length) {
    parts.push(`\n**Meetings (${d.meetings.length}):**`);
    for (const m of d.meetings) {
      const date = m.start_time?.slice(0, 10) ?? "no date";
      const att = Array.isArray(m.attendees) && m.attendees.length
        ? ` — with ${m.attendees.slice(0, 6).join(", ")}`
        : "";
      const summary = m.transcript_summary
        ? `\n  Summary: ${m.transcript_summary.slice(0, 400)}`
        : "";
      parts.push(`- [${date}] "${m.title}"${att}${summary}`);
    }
  }

  if (d.chunks.length) {
    parts.push(`\n**Transcript excerpts mentioning "${d.entity.name}" (${d.chunks.length}):**`);
    for (const c of d.chunks) {
      const label = c.topic_label ? `[${c.topic_label}]` : "";
      parts.push(`${label} ${c.chunk_text.slice(0, 600)}`);
    }
  }

  if (d.commitments.length) {
    parts.push(`\n**Open commitments (${d.commitments.length}):**`);
    for (const c of d.commitments) {
      const who =
        c.direction === "user_owes"
          ? "I owe"
          : c.direction === "counterpart_owes"
          ? "They owe"
          : "mutual";
      const due = c.do_by ? ` | due ${c.do_by}` : "";
      const cp = c.counterpart ? ` | ${c.counterpart}` : "";
      const co = c.company ? ` | ${c.company}` : "";
      parts.push(`- [${who}] "${c.title}" | ${c.status}${due}${cp}${co}`);
    }
  }

  if (d.pursuits.length) {
    parts.push(`\n**Pursuits (${d.pursuits.length}):**`);
    for (const p of d.pursuits) {
      parts.push(`- "${p.name}"${p.company ? ` | ${p.company}` : ""} | ${p.stage ?? p.status}`);
    }
  }

  if (d.memories.length) {
    parts.push(`\n**Memories (${d.memories.length}):**`);
    for (const m of d.memories) {
      parts.push(`- ${m.content}`);
    }
  }

  return parts.join("\n");
}

// ============================================================
// STAGE 4 — Synthesize the report
// ============================================================

const STAGE4_SYSTEM = `You are writing a detailed pre-event engagement briefing for Dustin Collis,
Head of Adobe Practice NA at EPAM Systems.

Write for someone reading on a phone on a plane. Scannable sections, concrete specifics, not walls of text.
Cite every fact as [Briefing] or [Resurface]. Never fabricate.

When a dossier provides transcript excerpts, commitments, or memories, USE THEM. Quote specifics.
Do not summarize the dossier — mine it for the exact detail that makes this person or company
different from everyone else in the room. Names, dates, dollar amounts, who said what.`;

const STAGE4_USER = (
  bundleName: string,
  briefing: string,
  dossiers: string,
  coldList: string,
  gapsText: string
) => `
Event: ${bundleName}

BRIEFING (scheduling, logistics, named attendees):
${briefing}

---
DOSSIERS — every entity below has Resurface history. Use all of it.
${dossiers}

---
COLD CONTACTS (named in briefing, no Resurface history found):
${coldList || "None."}

---
OPEN GAPS:
${gapsText || "None."}

---
Now write the engagement briefing report:

# [Event Name] — Engagement Briefing

## Executive Summary
5-7 bullets. The most important moments of the week, each with a name and a specific action.

## Priority Accounts
One section per priority account (entities with the strongest Resurface dossiers + scheduled touchpoints).
For each, write:
**[Account Name]**
- **Why priority:** [signals — be specific about the event touchpoint]
- **Resurface history:** Mine the dossier. Cite specific meeting dates, commitments, transcript quotes. What did they say? What's outstanding? What changed?
- **At this event:** Who to find, when, where (from briefing)
- **Your move:** A concrete ask or action grounded in the history above — not a generic "build relationship" line

## Warm Contacts
One line each: name, one-sentence history hook, one suggested moment to engage.

## Cold Contacts — Awareness Only
Bullet list (NOT a markdown table): Company — key contact — briefing signal.

## Schedule
Day-by-day. Call out overlaps and conflicts explicitly.

## Messaging & Talking Points
By offering, tied back to the priority accounts that care about each.

## Open Gaps & Decisions Needed
Numbered.

## Quick Reference
The names/times/locations/rooms you'll look up in a hurry on your phone.`;

// ============================================================
// Claude callers
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
    tools: [{ name: toolName, description: toolDescription, input_schema: inputSchema }],
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

  if (!toolBlock || typeof toolBlock.input !== "object" || toolBlock.input === null) {
    throw new Error(`Expected tool_use block '${toolName}' not found`);
  }

  return { input: toolBlock.input as T, usage: data.usage ?? {} };
}

// ============================================================
// Background worker
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
    // Load briefing + gaps
    const [docsRes, gapsRes] = await Promise.all([
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
    ]);

    if (!docsRes.data || docsRes.data.length === 0) {
      throw new Error("No documents found in bundle");
    }

    const briefingText = docsRes.data
      .map((d) => `# ${d.title}\n\n${d.content_md}`)
      .join("\n\n---\n\n");

    const gapsText = (gapsRes.data ?? []).map((g) => `- ${g.content}`).join("\n");

    // ── STAGE 1: read entities from bundle_entities (already populated by ingest) ──
    console.log("[report] Stage 1: loading entities from bundle_entities...");
    const { data: entityRows } = await adminClient
      .from("bundle_entities")
      .select("raw_name, entity_type")
      .eq("bundle_id", bundleId);

    const entities: ExtractedEntity[] = (entityRows ?? [])
      .filter((r) => typeof r.raw_name === "string" && r.raw_name.trim().length > 1)
      .map((r) => ({
        name: r.raw_name.trim(),
        type: r.entity_type === "person" ? "person" : "company",
      }));

    console.log(
      `[report] Stage 1 done: ${entities.length} entities (${
        entities.filter((e) => e.type === "person").length
      } people, ${entities.filter((e) => e.type === "company").length} companies)`
    );

    // ── STAGE 2: per-entity dossier lookup (parallel SQL) ──
    let withHits: EntityDossier[] = [];
    let withoutHits: EntityDossier[] = [];
    if (entities.length > 0) {
      console.log("[report] Stage 2: fetching per-entity dossiers...");
      const dossiers = await buildAllDossiers(entities, adminClient, userId);
      withHits = dossiers.filter((d) => d.totalHits > 0);
      withoutHits = dossiers.filter((d) => d.totalHits === 0);
      console.log(
        `[report] Stage 2 done: ${withHits.length} entities with history, ${withoutHits.length} cold`
      );
    } else {
      console.warn("[report] Stage 1 returned no entities; Stage 4 will synthesize from briefing alone");
    }

    // ── STAGE 3: format dossiers ──
    // Sort: most hits first, so Claude reads the richest ones when token-limited
    withHits.sort((a, b) => b.totalHits - a.totalHits);
    const dossierText = withHits.map(formatDossier).join("\n\n---\n\n");

    const coldList = withoutHits
      .map((d) => `${d.entity.name} (${d.entity.type})`)
      .join("\n");

    // ── STAGE 4: synthesize the report ──
    console.log("[report] Stage 4: synthesizing report...");
    const stage4 = await callClaude(
      anthropicKey,
      STAGE4_SYSTEM,
      STAGE4_USER(bundleName, briefingText, dossierText, coldList, gapsText),
      12000,
      true
    );
    for (const [k, v] of Object.entries(stage4.usage)) {
      totalUsage[k] = (totalUsage[k] ?? 0) + (v as number);
    }

    const reportText = stage4.text;
    const latencyMs = Date.now() - t0;

    // ── Save ──
    await adminClient.from("bundle_reports").delete().eq("bundle_id", bundleId);
    const { error: saveError } = await adminClient.from("bundle_reports").insert({
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
        pipeline: "entity-driven-v1",
        entities_total: entities.length,
        entities_with_history: withHits.length,
        entities_cold: withoutHits.length,
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
// HTTP handler — 202 + background work
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

    await adminClient
      .from("bundles")
      .update({
        report_status: "generating",
        report_error: null,
        report_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", bundle_id);

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
