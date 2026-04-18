import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import { recordAiCall } from "../_shared/telemetry.ts";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-7";

const SYSTEM_PROMPT = `You are preparing a pre-event briefing report for Dustin Collis, Head of Adobe Practice NA at EPAM Systems.

You have two sources:
1. BUNDLE: the event briefing — who is attending, what meetings are scheduled, what the agenda looks like
2. RESURFACE CONTEXT: what Dustin's own meeting history and work system already knows about those attendees

Your job is to cross-reference them and produce an actionable engagement plan.

## Priority Ranking Logic
An attendee or account is PRIORITY if one or more of these is true (ranked by weight):
- Resurface has meeting transcripts or notes with them (existing relationship)
- Resurface has open commitments to/from them (something owed or pending)
- Resurface has an active pursuit for their account
- They have a scheduled 1:1 meeting at this event
- They are registered for a meal/event Dustin is also attending (breakfast, BASH, dinners)

An attendee is DE-PRIORITIZED if:
- No Resurface history at all, and no scheduled touchpoint at this event
- Listed only in a general attendee roster with no other signal

## Required Report Structure

### 1. Executive Summary (5 bullets max — the most important things before landing)

### 2. Priority Accounts — Full Narratives
For each priority account: write a focused brief:
- **Why they're priority** (cite the signal: "3 prior meetings", "open commitment to demo TargetCue", "registered for breakfast")
- **What you know** from Resurface (key topics discussed, what they care about, any commitments)
- **What to do** at this event (specific ask, question to raise, or follow-up to close)
- **Who to find** (name, role, when/where you'll see them)

### 3. Warm Contacts — No Current Action Required
Accounts where a relationship exists but no immediate action is needed. One line each.

### 4. Cold Contacts — De-prioritized
Everyone else at the event with no Resurface history and no scheduled touchpoint. Compact table:
| Company | Contact | Notes from briefing |

### 5. Schedule
Day-by-day. Conflicts called out inline.

### 6. Messaging & Talking Points
By EPAM offering/topic. Only what's relevant to the priority accounts.

### 7. Open Gaps
What's still unresolved that affects planning.

### 8. Quick Reference
Key names, room numbers, meal times, logistics. The things you look up in a hurry.

Rules:
- Cite sources: [Briefing] or [Resurface] for every factual claim
- Never fabricate — if Resurface has nothing on a person, say so
- Write for mobile reading — short paragraphs, bullets, no walls of text`;

// ============================================================
// Resurface context loader
// For each bundle entity (person or company), fetch what
// Resurface knows: meetings, commitments, items, pursuits.
// Returns a compact text block per entity, capped to avoid
// blowing out the context window.
// ============================================================

// Load the full Resurface catalog in one shot and return as a structured
// text block. Claude cross-references this against the bundle attendee
// lists — catches name variations, abbreviations, and fuzzy matches that
// per-entity query-by-query search misses.
async function loadResurfaceCatalog(
  adminClient: ReturnType<typeof createClient>,
  userId: string
): Promise<string> {
  const [meetingsRes, commitmentsRes, pursuitsRes, memoriesRes, itemsRes] =
    await Promise.all([
      // Meeting titles + dates + summaries (no full transcripts — too large)
      adminClient
        .from("meetings")
        .select("title, start_time, attendees, transcript_summary")
        .eq("user_id", userId)
        .order("start_time", { ascending: false })
        .limit(300),

      // All open commitments
      adminClient
        .from("commitments")
        .select("title, counterpart, company, status, direction, do_by")
        .eq("user_id", userId)
        .neq("status", "met")
        .limit(100),

      // All active pursuits
      adminClient
        .from("pursuits")
        .select("name, company, status, stage")
        .eq("user_id", userId)
        .neq("status", "archived")
        .limit(50),

      // All memories
      adminClient
        .from("memories")
        .select("content, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),

      // Open items with company tags
      adminClient
        .from("items")
        .select("title, status, custom_fields")
        .eq("user_id", userId)
        .neq("status", "done")
        .not("custom_fields->company", "is", null)
        .limit(100),
    ]);

  const parts: string[] = [];

  const meetings = meetingsRes.data ?? [];
  if (meetings.length > 0) {
    parts.push(
      `## Your Meetings (${meetings.length} most recent)\n` +
        meetings
          .map((m) => {
            const attendeeStr = Array.isArray(m.attendees) && m.attendees.length
              ? ` | Attendees: ${(m.attendees as string[]).join(", ")}`
              : "";
            const summary = m.transcript_summary
              ? ` | Summary: ${m.transcript_summary.slice(0, 150)}`
              : "";
            return `- "${m.title}" (${m.start_time?.slice(0, 10) ?? "no date"})${attendeeStr}${summary}`;
          })
          .join("\n")
    );
  }

  const commitments = commitmentsRes.data ?? [];
  if (commitments.length > 0) {
    parts.push(
      `## Open Commitments (${commitments.length})\n` +
        commitments
          .map(
            (c) =>
              `- [${c.direction}] "${c.title}"${c.counterpart ? ` | Person: ${c.counterpart}` : ""}${c.company ? ` | Company: ${c.company}` : ""} | Status: ${c.status}${c.do_by ? ` | Due: ${c.do_by}` : ""}`
          )
          .join("\n")
    );
  }

  const pursuits = pursuitsRes.data ?? [];
  if (pursuits.length > 0) {
    parts.push(
      `## Active Pursuits (${pursuits.length})\n` +
        pursuits
          .map(
            (p) =>
              `- "${p.name}"${p.company ? ` | Company: ${p.company}` : ""} | Status: ${p.stage ?? p.status}`
          )
          .join("\n")
    );
  }

  const memories = memoriesRes.data ?? [];
  if (memories.length > 0) {
    parts.push(
      `## Memories / Saved Notes (${memories.length})\n` +
        memories.map((m) => `- ${m.content}`).join("\n")
    );
  }

  const items = itemsRes.data ?? [];
  if (items.length > 0) {
    parts.push(
      `## Open Items with Company Tags (${items.length})\n` +
        items
          .map(
            (i) =>
              `- "${i.title}" | Company: ${(i.custom_fields as Record<string, unknown>)?.company ?? "?"} | Status: ${i.status}`
          )
          .join("\n")
    );
  }

  if (parts.length === 0) {
    return "No Resurface data found (meetings, commitments, pursuits, or memories).";
  }

  return parts.join("\n\n");
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

    // Verify bundle ownership and readiness
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

    if (bundle.status !== "ready") {
      return new Response(
        JSON.stringify({ error: "Bundle must be ingested before generating a report" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load source docs, gaps, and full Resurface catalog in parallel
    const [docsRes, gapsRes, resurfaceCatalog] = await Promise.all([
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

    if (docsRes.error || !docsRes.data || docsRes.data.length === 0) {
      return new Response(
        JSON.stringify({ error: "No documents found in bundle" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sourceContent = docsRes.data
      .map((d) => `# ${d.title}\n\n${d.content_md}`)
      .join("\n\n---\n\n");

    const gapsBlock =
      gapsRes.data && gapsRes.data.length > 0
        ? `\n\n---\n\n# Open Gaps\n\n${gapsRes.data.map((g) => `- ${g.content}`).join("\n")}`
        : "";

    const userContent = `Bundle: ${bundle.name}

---
BRIEFING DOCUMENTS (who is at the event, what is scheduled):
${sourceContent}${gapsBlock}

---
RESURFACE DATABASE (your full history — meetings, commitments, pursuits, memories, open items):
${resurfaceCatalog}

---
Cross-reference every person and company in the briefing attendee lists against the Resurface database above.
Look for name matches, company matches, abbreviations, and partial matches (e.g. "WK" = "Wolters Kluwer").
Use that cross-reference to produce the priority/warm/cold engagement plan.`;

    const t0 = Date.now();
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        thinking: { type: "adaptive" },
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userContent }],
      }),
    });

    const latencyMs = Date.now() - t0;

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Claude API error ${res.status}: ${body}`);
    }

    const data = await res.json();

    const reportText = (data.content as { type: string; text?: string }[])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

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
      usage: data.usage,
      stop_reason: data.stop_reason,
      latency_ms: latencyMs,
      source_type: "bundle",
      source_id: bundle_id,
      metadata: { approach: "full_catalog" },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        report_id: savedReport?.id,
        content_md: reportText,
        stats: { approach: "full_catalog" },
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
