import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

const REPORT_TYPES = [
  "strategic_assessment",
  "action_plan",
  "competitive_landscape",
  "account_map",
  "trend_analysis",
] as const;

type ReportType = (typeof REPORT_TYPES)[number];

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

    // Auth — accept user JWT or service role
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
      // Need user_id from body or default
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

    const body = await req.json();
    const { cluster_id, report_type, regenerate } = body as {
      cluster_id: string;
      report_type: ReportType;
      regenerate?: boolean;
    };

    if (!cluster_id || !report_type) {
      return new Response(
        JSON.stringify({ error: "cluster_id and report_type required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!REPORT_TYPES.includes(report_type)) {
      return new Response(
        JSON.stringify({ error: `Invalid report_type. Must be one of: ${REPORT_TYPES.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check cache unless regenerate requested
    if (!regenerate) {
      const { data: cached } = await adminClient
        .from("cluster_reports")
        .select("*")
        .eq("user_id", userId)
        .eq("cluster_id", cluster_id)
        .eq("report_type", report_type)
        .maybeSingle();

      if (cached) {
        return new Response(JSON.stringify({ ...cached, from_cache: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Fetch ideas for this cluster
    const { data: ideas, error: ideasErr } = await adminClient
      .from("ideas")
      .select("title, description, evidence_text, company_name, category, originated_by, created_at, source_meeting_id")
      .eq("cluster_id", cluster_id)
      .order("created_at", { ascending: true });

    if (ideasErr) throw ideasErr;
    if (!ideas || ideas.length === 0) {
      return new Response(
        JSON.stringify({ error: "No ideas found for this cluster" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get cluster label from first idea
    const { data: labelRow } = await adminClient
      .from("ideas")
      .select("cluster_label")
      .eq("cluster_id", cluster_id)
      .limit(1)
      .single();
    const clusterLabel = labelRow?.cluster_label ?? "Unknown Cluster";

    // Fetch meeting titles for context
    const meetingIds = [...new Set(ideas.map((i) => i.source_meeting_id).filter(Boolean))];
    let meetingTitles: Record<string, string> = {};
    if (meetingIds.length > 0) {
      const { data: meetings } = await adminClient
        .from("meetings")
        .select("id, title")
        .in("id", meetingIds);
      if (meetings) {
        for (const m of meetings) meetingTitles[m.id] = m.title;
      }
    }

    // Build ideas text for prompt
    const ideasText = ideas
      .map((idea) => {
        const date = idea.created_at
          ? new Date(idea.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "unknown date";
        const meetingTitle = idea.source_meeting_id
          ? meetingTitles[idea.source_meeting_id] || "untitled meeting"
          : "unknown meeting";
        return `### Idea: ${idea.title}
- Description: ${idea.description || "No description"}
- Originator: ${idea.originated_by || "Unknown"}
- Company/Account: ${idea.company_name || "General / internal"}
- Date captured: ${date}
- Source meeting: ${meetingTitle}
- Evidence: ${idea.evidence_text ? `"${idea.evidence_text}"` : "None captured"}`;
      })
      .join("\n\n");

    // Derive metadata
    const companies = [...new Set(ideas.map((i) => i.company_name).filter(Boolean))];
    const originators = [...new Set(ideas.map((i) => i.originated_by).filter(Boolean))];
    const dates = ideas.map((i) => i.created_at).filter(Boolean).sort();
    const dateRange = dates.length > 0
      ? `${new Date(dates[0]).toLocaleDateString("en-US", { month: "short", year: "numeric" })} to ${new Date(dates[dates.length - 1]).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
      : "unknown";

    const prompt = buildPrompt(report_type, {
      clusterLabel,
      ideasText,
      ideaCount: ideas.length,
      meetingCount: meetingIds.length,
      dateRange,
      companies,
      originators,
      earliestDate: dates[0] ? new Date(dates[0]).toLocaleDateString("en-US") : "unknown",
      latestDate: dates.length > 0 ? new Date(dates[dates.length - 1]).toLocaleDateString("en-US") : "unknown",
    });

    // Call Claude
    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      return new Response(
        JSON.stringify({ error: "Claude API error", detail: errText.substring(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResult = await aiResp.json();
    const content = aiResult.content?.[0]?.text ?? "";

    // Upsert into cache
    const { error: upsertErr } = await adminClient
      .from("cluster_reports")
      .upsert(
        {
          user_id: userId,
          cluster_id,
          cluster_label: clusterLabel,
          report_type,
          content,
          model: "claude-sonnet-4-20250514",
          generated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,cluster_id,report_type" }
      );

    if (upsertErr) {
      console.error("Failed to cache report:", upsertErr);
    }

    return new Response(
      JSON.stringify({
        cluster_id,
        cluster_label: clusterLabel,
        report_type,
        content,
        generated_at: new Date().toISOString(),
        from_cache: false,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================================
// Prompt templates
// ============================================================

interface PromptData {
  clusterLabel: string;
  ideasText: string;
  ideaCount: number;
  meetingCount: number;
  dateRange: string;
  companies: string[];
  originators: string[];
  earliestDate: string;
  latestDate: string;
}

function buildPrompt(type: ReportType, d: PromptData): string {
  switch (type) {
    case "strategic_assessment":
      return `You are a senior strategy advisor to a GTM executive at EPAM Systems, a global IT services and digital transformation company. You have been asked to brief the executive on a strategic theme emerging from their meeting notes.

## Theme
${d.clusterLabel}

## Ideas in This Cluster
${d.ideasText}

## Context
These ${d.ideaCount} ideas were extracted from ${d.meetingCount} meetings over the period ${d.dateRange}. Companies referenced are EPAM's clients or prospects.

## Your Task
Write a strategic assessment of this theme. 400-600 words covering:

**What this theme is really about** — synthesize the individual ideas into a coherent strategic narrative. Find the thread connecting them.

**Why this matters now** — given EPAM's position as an IT services company, why is this theme strategically important? What market forces are driving it?

**Strength of signal** — how strong is the evidence? Is this one person's pet idea or are multiple people across accounts independently arriving at similar conclusions?

**Strategic options** — 2-3 concrete things the executive could do with this theme. Be specific to EPAM's business model.

**Key risk** — what could make this a dead end?

Write in a direct, advisory tone. No hedging. Use bold for key phrases. Narrative prose, not bullet lists.`;

    case "action_plan":
      return `You are an execution-focused chief of staff helping a senior GTM executive at EPAM Systems turn strategic themes into concrete action.

## Theme
${d.clusterLabel}

## Ideas in This Cluster
${d.ideasText}

## Context
These ${d.ideaCount} ideas were captured from meetings between ${d.dateRange}.

## Your Task
Write an action plan. 300-500 words:

**The 30-second version** — one paragraph summarizing what to do and why, forwardable to the team as-is.

**Immediate actions (this week)** — 2-3 specific things with clear verbs and owners. Name people from the ideas.

**Near-term moves (next 30 days)** — what needs to happen to validate or advance this theme. Be specific: "Schedule a working session with X to map the Y use case" not "explore opportunities."

**What to stop or deprioritize** — if pursuing this, what gets less attention?

**Decision needed** — frame the one decision required as a clear choice with tradeoffs.

Short, punchy sentences. Working document, not strategy deck.`;

    case "competitive_landscape":
      return `You are a competitive intelligence analyst supporting a senior GTM executive at EPAM Systems. You understand the IT services and digital transformation market deeply.

## Theme
${d.clusterLabel}

## Ideas in This Cluster
${d.ideasText}

## Companies Referenced
${d.companies.join(", ") || "General / internal"}

## Your Task
Write a competitive landscape analysis. 400-600 words covering:

**Market context** — how is the broader market addressing this theme? Which competitors are active? Be specific about Accenture, Infosys, TCS, Cognizant, Thoughtworks, Perficient.

**EPAM's position** — based on these ideas, where does EPAM stand? Catching up, matching, or getting ahead?

**Client-side dynamics** — what does the pattern of which clients raise this theme tell you?

**Differentiation opportunity** — given EPAM's engineering-led culture, what's the unique angle competitors wouldn't take?

**Timing assessment** — is EPAM early, on time, or late? What's the cost of waiting 6 more months?

Use your knowledge of the IT services market as of early 2026. If EPAM is behind, say so. The executive values honesty.`;

    case "account_map":
      return `You are an account strategist helping a senior GTM executive at EPAM Systems understand how a strategic theme connects to their client portfolio.

## Theme
${d.clusterLabel}

## Ideas in This Cluster
${d.ideasText}

## Your Task
Write an account mapping analysis. 300-500 words:

**Account concentration** — which accounts generate the most thinking here? One dominant account or emerging independently across many?

**Originator analysis** — are ideas coming from EPAM people (internal strategy) or client-side (market demand)? If one person dominates, is it genuine signal or a hobby horse?

**Cross-account opportunities** — are there ideas from different accounts that could be connected? Same solution sold twice?

**White space** — which accounts in EPAM's portfolio are NOT represented but probably should be?

**Relationship leverage** — which account relationship is the strongest entry point? Who should the executive talk to first?

Be specific. Use names and companies from the data.`;

    case "trend_analysis":
      return `You are a strategic analyst helping a senior GTM executive at EPAM Systems understand how a theme is evolving over time.

## Theme
${d.clusterLabel}

## Ideas in This Cluster (chronologically ordered)
${d.ideasText}

## Timeline
First idea: ${d.earliestDate}
Most recent: ${d.latestDate}
Span: ${d.dateRange}
Total ideas: ${d.ideaCount} from ${d.meetingCount} meetings

## Your Task
Write a trend analysis. 300-500 words:

**Evolution of thinking** — how has the theme changed from earliest to most recent? Did it sharpen, branch, or shift framing?

**Velocity** — is the rate accelerating, steady, or decelerating? What does the pattern tell you?

**Trigger events** — what prompted surges? Correlate dates with likely business events.

**Maturity assessment** — grade it: Early exploration / Converging / Ready to act / Stalled

**Forecast** — what will this look like in 3-6 months if nothing changes? What would accelerate it?

Be honest about data limits. Don't over-interpret thin datasets.`;
  }
}
