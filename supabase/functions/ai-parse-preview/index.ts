import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

// Read-only parse preview. Takes meeting_id + model, runs the historical
// parse prompt, returns the result WITHOUT touching the DB. Used for
// model comparison experiments.

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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const isServiceRole = token === serviceRoleKey;

    if (!isServiceRole) {
      const { data: { user } } = await adminClient.auth.getUser(token);
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { meeting_id, model } = await req.json();
    if (!meeting_id || !model) {
      return new Response(
        JSON.stringify({ error: "meeting_id and model required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Allow-list the models we'll run
    const ALLOWED_MODELS = new Set([
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
    ]);
    if (!ALLOWED_MODELS.has(model)) {
      return new Response(
        JSON.stringify({ error: `model must be one of ${Array.from(ALLOWED_MODELS).join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: meeting, error: meetingErr } = await adminClient
      .from("meetings")
      .select("id, title, start_time, attendees, transcript")
      .eq("id", meeting_id)
      .single();
    if (meetingErr || !meeting) {
      return new Response(
        JSON.stringify({ error: "meeting not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!meeting.transcript || (meeting.transcript as string).length < 100) {
      return new Response(
        JSON.stringify({ error: "meeting has no substantial transcript" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const attendees = (meeting.attendees as string[]) ?? [];
    const attendeesStr = attendees.length > 0 ? attendees.join(", ") : "unknown";
    const meetingDate = (meeting.start_time as string | null)?.substring(0, 10) ?? "unknown";

    const prompt = `You are analyzing a historical meeting transcript for Dustin Collis, Head of Content Go-to-Market at EPAM. Extract structured information for archival and pattern analysis purposes, not actionable tasks.

**Dustin's role:** Runs partner alliances (Adobe, Sitecore, ContentStack, Contentful, Microsoft) for content management, DAM, and search. E-commerce is NOT his scope — a counterpart owns commerce.

**Meeting date:** ${meetingDate}
**Known attendees:** ${attendeesStr}

Extract:

1. **SYNOPSIS** — structured markdown:
   - ## Overview (one paragraph)
   - ## Key Topics Discussed (bulleted)
   - ## Participants & Perspectives (bulleted)
   - ## Outcomes & Next Steps

2. **PARTICIPANTS** — every person who spoke or was referenced. name, company (if determinable), role (if mentioned).

3. **DECISIONS** — specific decisions made.

4. **OPEN QUESTIONS** — unresolved items needing follow-up.

5. **COMMITMENTS** — promises/obligations, both outgoing (Dustin promised) and incoming (promised to Dustin). Include: title, description, direction (outgoing|incoming), counterpart, company, do_by, evidence_quote. Only explicit commitments.

6. **KEY TOPICS** — 3-8 short topic labels.

7. **IDEAS — STRICT CRITERIA.** Strategic ideas worth archiving for future reference. BE HIGHLY SELECTIVE. Most meetings produce 0-3 real strategic ideas.

   An idea COUNTS only if ALL are true:
   - Proposes a new strategic approach, offering, GTM motion, positioning angle, or partnership play
   - Specific enough to be actionable (names a company, approach, or concrete concept)
   - Relevant to content GTM (not commerce, not HR, not low-level technical implementation)
   - Originator clearly identified by name (NOT "Speaker N" or "Unknown")
   - Novel or sharp enough to be worth re-reading in 3 months

   Skip: tactical/operational minutiae, out-of-scope, generic platitudes, restatement of obvious, vague exploration language, descriptions of current practice.

   For each: title, description, originated_by (real name only), company, category (gtm_motion|selling_approach|partnership|positioning|campaign|bundling|product|process|other), evidence_quote.

8. **SUGGESTED TITLE** — 4-10 words.
9. **DISCUSSION COMPANY** — account the whole meeting is about, or null.

Transcript:
${meeting.transcript}

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "summary": "string",
  "title": "string",
  "company": "string or null",
  "participants": [{"name": "string", "company": "string or null", "role": "string or null"}],
  "decisions": [{"decision": "string", "context": "string"}],
  "open_questions": [{"question": "string", "owner": "string or null"}],
  "commitments": [{"title": "string", "description": "string or null", "direction": "outgoing|incoming", "counterpart": "string or null", "company": "string or null", "do_by": "YYYY-MM-DD or null", "evidence_quote": "string"}],
  "topics": ["string"],
  "ideas": [{"title": "string", "description": "string", "originated_by": "string or null", "company": "string or null", "category": "string", "evidence_quote": "string"}]
}`;

    const startedAt = Date.now();
    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
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
    const elapsedMs = Date.now() - startedAt;
    let rawContent = aiResult.content?.[0]?.text ?? "";
    if (rawContent.startsWith("```")) {
      rawContent = rawContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(rawContent.trim());
    } catch {
      return new Response(
        JSON.stringify({ error: "failed to parse AI response", raw: rawContent.substring(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        meeting_id,
        meeting_title: meeting.title,
        model,
        elapsed_ms: elapsedMs,
        usage: aiResult.usage ?? {},
        result: parsed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "internal server error", detail: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
