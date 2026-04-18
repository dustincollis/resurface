import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import { recordAiCall } from "../_shared/telemetry.ts";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-7";

// ============================================================
// Pass 1: identify priority accounts and matched Resurface IDs
// ============================================================

const PASS1_SYSTEM = `You cross-reference event briefings against a user's work history database.
Return ONLY valid JSON — no markdown fences, no explanation, no preamble.`;

const PASS1_USER_TEMPLATE = (bundleName: string, briefing: string, catalog: string) => `
Event: ${bundleName}

BRIEFING (who is at the event, what is scheduled):
${briefing}

RESURFACE CATALOG (meeting history, commitments, pursuits — includes meeting UUIDs):
${catalog}

Cross-reference every person and company in the briefing against the Resurface catalog.
Look for exact matches, abbreviations (e.g. "WK" = "Wolters Kluwer"), partial names, and related entities.

Return this exact JSON shape:
{
  "priority": [
    {
      "display_name": "Company or person name as it appears in the briefing",
      "type": "company or person",
      "signals": ["scheduled 1:1", "BASH bus", "open commitment", "prior meeting — 3 meetings found", etc.],
      "matched_meeting_ids": ["uuid1", "uuid2"],
      "matched_commitment_ids": ["uuid1"],
      "matched_pursuit_ids": ["uuid1"],
      "briefing_context": "Key facts from the briefing: who to find, when/where, why they matter",
      "resurface_summary": "What Resurface shows: meeting titles, dates, key topics, open items. 'No history' if none found."
    }
  ],
  "warm": [
    {
      "display_name": "string",
      "type": "company or person",
      "matched_meeting_ids": ["uuid1"],
      "resurface_summary": "Brief: X meetings, last contact YYYY-MM-DD"
    }
  ],
  "cold": ["Company A", "Person B"]
}

Priority rules:
- PRIORITY = has Resurface history OR has a scheduled 1:1/meal/event touchpoint at Summit
- WARM = Resurface history exists but no specific Summit touchpoint
- COLD = no Resurface history, no scheduled touchpoint
- Max 20 priority accounts
- Include every named person and company from the briefing in one of the three buckets
- matched_meeting_ids: only include IDs that clearly match — no guessing`;

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
// Resurface catalog loader (includes IDs for pass 1 matching)
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
              ? ` | Summary: ${m.transcript_summary.slice(0, 200)}`
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

  return parts.length > 0
    ? parts.join("\n\n")
    : "No Resurface data found.";
}

// ============================================================
// Chunk loader for matched meetings (pass 2 enrichment)
// ============================================================
async function loadMeetingChunks(
  adminClient: ReturnType<typeof createClient>,
  meetingIds: string[],
  maxChunksPerMeeting = 5
): Promise<Map<string, string>> {
  if (meetingIds.length === 0) return new Map();

  const result = new Map<string, string>();

  // Load chunks in batches to avoid URL length limits
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
      // Cap at maxChunksPerMeeting per meeting
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
// Claude caller
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

    const { bundle_id } = await req.json() as { bundle_id: string };
    if (!bundle_id) {
      return new Response(
        JSON.stringify({ error: "bundle_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: bundle } = await adminClient
      .from("bundles")
      .select("id, name, status")
      .eq("id", bundle_id)
      .eq("user_id", userId)
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

    // Load bundle docs, gaps, and Resurface catalog in parallel
    const [docsRes, gapsRes, catalog] = await Promise.all([
      adminClient
        .from("bundle_documents")
        .select("title, content_md, position")
        .eq("bundle_id", bundle_id)
        .order("position"),
      adminClient
        .from("bundle_gaps")
        .select("content, state")
        .eq("bundle_id", bundle_id)
        .order("position"),
      loadResurfaceCatalog(adminClient, userId),
    ]);

    if (!docsRes.data || docsRes.data.length === 0) {
      return new Response(
        JSON.stringify({ error: "No documents found in bundle" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const briefingText = docsRes.data
      .map((d) => `# ${d.title}\n\n${d.content_md}`)
      .join("\n\n---\n\n");

    const gapsText = (gapsRes.data ?? []).map((g) => `- ${g.content}`).join("\n");

    const t0 = Date.now();
    let totalUsage: Record<string, number> = {};

    // ──────────────────────────────────────────────
    // PASS 1: cross-reference + priority ranking
    // ──────────────────────────────────────────────
    console.log("[report] Pass 1: cross-referencing...");
    const pass1 = await callClaude(
      anthropicKey,
      PASS1_SYSTEM,
      PASS1_USER_TEMPLATE(bundle.name, briefingText, catalog),
      4096,
      false
    );

    // Accumulate usage
    for (const [k, v] of Object.entries(pass1.usage)) {
      totalUsage[k] = (totalUsage[k] ?? 0) + (v as number);
    }

    // Parse pass 1 JSON
    let rankings: {
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

    try {
      const jsonStr = pass1.text
        .replace(/^```(?:json)?\s*/m, "")
        .replace(/\s*```$/m, "")
        .trim();
      rankings = JSON.parse(jsonStr);
    } catch (e) {
      console.error("[report] Pass 1 JSON parse failed:", pass1.text.slice(0, 500));
      throw new Error(`Pass 1 JSON parse failed: ${e}`);
    }

    // ──────────────────────────────────────────────
    // Between passes: load transcript chunks for all matched meetings
    // ──────────────────────────────────────────────
    const allMatchedMeetingIds = [
      ...rankings.priority.flatMap((p) => p.matched_meeting_ids ?? []),
      ...rankings.warm.flatMap((w) => w.matched_meeting_ids ?? []),
    ].filter(Boolean);

    const uniqueMeetingIds = [...new Set(allMatchedMeetingIds)];
    console.log(`[report] Loading chunks for ${uniqueMeetingIds.length} matched meetings...`);

    const chunksByMeeting = await loadMeetingChunks(adminClient, uniqueMeetingIds, 6);

    // Also load meeting titles for matched IDs (to label the chunks)
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

    // Build enriched priority blocks for pass 2
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
      .map(
        (w) =>
          `- **${w.display_name}**: ${w.resurface_summary}`
      )
      .join("\n");

    const coldList = (rankings.cold ?? []).join(", ");

    // ──────────────────────────────────────────────
    // PASS 2: write the full deep report
    // ──────────────────────────────────────────────
    console.log("[report] Pass 2: writing full report...");
    const pass2 = await callClaude(
      anthropicKey,
      PASS2_SYSTEM,
      PASS2_USER_TEMPLATE(bundle.name, priorityBlocks, warmList, coldList, briefingText, gapsText),
      8192,
      true
    );

    for (const [k, v] of Object.entries(pass2.usage)) {
      totalUsage[k] = (totalUsage[k] ?? 0) + (v as number);
    }

    const latencyMs = Date.now() - t0;
    const reportText = pass2.text;

    // Save report
    await adminClient.from("bundle_reports").delete().eq("bundle_id", bundle_id);
    const { data: savedReport, error: saveError } = await adminClient
      .from("bundle_reports")
      .insert({
        bundle_id,
        content_md: reportText,
        model: MODEL,
        generated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (saveError) throw new Error(`Failed to save report: ${saveError.message}`);

    await recordAiCall(adminClient, {
      user_id: userId,
      function_name: "ai-bundle-report",
      model: MODEL,
      usage: totalUsage,
      latency_ms: latencyMs,
      source_type: "bundle",
      source_id: bundle_id,
      metadata: {
        passes: 2,
        priority_accounts: rankings.priority.length,
        warm_accounts: rankings.warm.length,
        cold_accounts: (rankings.cold ?? []).length,
        matched_meetings: uniqueMeetingIds.length,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        report_id: savedReport?.id,
        content_md: reportText,
        stats: {
          priority: rankings.priority.length,
          warm: rankings.warm.length,
          cold: (rankings.cold ?? []).length,
          matched_meetings: uniqueMeetingIds.length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[ai-bundle-report] error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
