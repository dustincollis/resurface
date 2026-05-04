import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import {
  createIdentityResolver,
} from "../_shared/resolve-identity.ts";
import { recordAiCall } from "../_shared/telemetry.ts";
import { suggestPursuitLink } from "../_shared/pursuit-matcher.ts";

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

    const { meeting_id, transcript: bodyTranscript, user_context, mode: requestMode } = await req.json();
    if (!meeting_id) {
      return new Response(
        JSON.stringify({ error: "meeting_id required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    // The transcript can come from the request body (normal flow) OR be read
    // from the meeting record (re-trigger flow, where the body may be empty
    // or a stub). We resolve this AFTER loading the meeting below.
    let transcript: string = typeof bodyTranscript === "string" ? bodyTranscript : "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // Supabase now exposes TWO service-role env vars with different values:
    //   SB_SERVICE_ROLE_KEY       — new short-format key (sb_sec_...)
    //   SUPABASE_SERVICE_ROLE_KEY — legacy JWT-format key (eyJhbG...)
    // A caller might send either. Accept both as valid service-role auth.
    const serviceRoleKeyLegacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const serviceRoleKeyNew = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";
    const serviceRoleKey = serviceRoleKeyLegacy || serviceRoleKeyNew;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Auth: support both browser-side user JWTs AND server-to-server
    // service role calls (from the Python sync script). The two flows
    // diverge on how we determine the target user_id.
    //
    // Also accept the apikey header as an alternative service-role channel,
    // since some clients send the key there instead of in Authorization.
    const apiKeyHeader = req.headers.get("apikey") ?? req.headers.get("ApiKey") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const tokenMatchesServiceRole =
      (!!serviceRoleKeyLegacy && token === serviceRoleKeyLegacy) ||
      (!!serviceRoleKeyNew && token === serviceRoleKeyNew);
    const apiKeyMatchesServiceRole =
      (!!serviceRoleKeyLegacy && apiKeyHeader === serviceRoleKeyLegacy) ||
      (!!serviceRoleKeyNew && apiKeyHeader === serviceRoleKeyNew);
    const isServiceRole = tokenMatchesServiceRole || apiKeyMatchesServiceRole;

    // Debug fingerprint helper — never logs full keys
    function fingerprint(s: string | null | undefined): string {
      if (!s) return "<empty>";
      if (s.length < 16) return `<short:${s.length}>`;
      return `${s.slice(0, 6)}...${s.slice(-4)}(len=${s.length})`;
    }

    // Look up the meeting first regardless of auth path. Service role calls
    // derive user_id from the meeting record; user JWT calls verify ownership.
    const { data: meeting, error: meetingError } = await adminClient
      .from("meetings")
      .select("*")
      .eq("id", meeting_id)
      .single();

    if (meetingError || !meeting) {
      return new Response(JSON.stringify({ error: "Meeting not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If the body's transcript is empty or very short (e.g. a re-trigger
    // stub), fall back to the meeting record's existing transcript. This
    // makes it safe to re-trigger parsing by just sending the meeting_id
    // without needing to also supply the full transcript content.
    if (transcript.length < 100) {
      const existingTranscript = meeting.transcript as string | null;
      if (existingTranscript && existingTranscript.length >= 100) {
        transcript = existingTranscript;
      } else if (!transcript && !existingTranscript) {
        return new Response(
          JSON.stringify({ error: "No transcript in request body or on the meeting record" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    let userId: string;
    let userEmail: string | null = null;
    if (isServiceRole) {
      // Trust the caller; the meeting row already tells us who owns it.
      userId = meeting.user_id;
    } else {
      // Browser flow: verify the JWT and check ownership.
      const {
        data: { user },
      } = await adminClient.auth.getUser(token);
      if (!user) {
        return new Response(
          JSON.stringify({
            error: "Unauthorized",
            diag: {
              auth_header_present: Boolean(authHeader),
              auth_token_fp: fingerprint(token),
              apikey_header_fp: fingerprint(apiKeyHeader),
              service_role_env_fp: fingerprint(serviceRoleKey),
              token_equals_service_role: token === serviceRoleKey,
              apikey_equals_service_role: apiKeyHeader === serviceRoleKey,
              service_role_env_source: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
                ? "SUPABASE_SERVICE_ROLE_KEY"
                : Deno.env.get("SB_SERVICE_ROLE_KEY")
                  ? "SB_SERVICE_ROLE_KEY"
                  : "<none>",
            },
          }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (meeting.user_id !== user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
      userEmail = user.email ?? null;
    }

    // Determine parse mode. "historical" skips proposals, extracts topics
    // + ideas, creates historical commitments directly. Default is "active"
    // which preserves the original real-time behavior.
    // If mode not explicitly set, infer from import_mode on the meeting.
    const importMode = (meeting.import_mode as string | undefined) ?? "active";
    const parseMode: "active" | "historical" =
      requestMode === "historical"
        ? "historical"
        : importMode === "archive"
          ? "historical"
          : "active";

    // Fetch user's display name so we can teach the AI who "the user" is
    // by name, and so we can later filter action items by assignee.
    const { data: profile } = await adminClient
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .single();
    const userDisplayName: string =
      (profile?.display_name as string | undefined)?.trim() ||
      userEmail?.split("@")[0] ||
      "the user";

    // Resolve relative dates ("tomorrow", "next week", "by Friday") against
    // the date the MEETING took place, not the date we happen to be parsing.
    const meetingDate: Date =
      meeting.start_time ? new Date(meeting.start_time as string) : new Date();
    const meetingDateStr = isNaN(meetingDate.getTime())
      ? new Date().toISOString().split("T")[0]
      : meetingDate.toISOString().split("T")[0];
    const meetingDayOfWeek = isNaN(meetingDate.getTime())
      ? ""
      : new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(meetingDate);

    // Get user's existing items for cross-referencing (active mode only)
    let itemsSummary = "No existing items.";
    if (parseMode === "active") {
      const { data: items } = await adminClient
        .from("items")
        .select("id, title, stream_id, streams(name)")
        .eq("user_id", userId)
        .not("status", "in", '("done","dropped")');

      itemsSummary = items
        ?.map(
          (i) =>
            `- id=${i.id} title="${i.title}" stream=${(i.streams as { name: string } | null)?.name ?? "none"}`
        )
        .join("\n") ?? "No existing items.";
    }

    // Existing memories — passed to the parser so it doesn't re-propose
    // facts it already knows. Cap at 100 to keep the prompt bounded.
    let existingMemories = "";
    {
      const { data: memRows } = await adminClient
        .from("memories")
        .select("content")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (memRows && memRows.length > 0) {
        existingMemories = memRows
          .map((m) => `- ${m.content}`)
          .join("\n");
      }
    }

    // For historical mode, fetch existing topic vocabulary for consistency
    let topicVocabulary = "";
    if (parseMode === "historical") {
      const { data: topicRows } = await adminClient
        .from("meetings")
        .select("extracted_topics")
        .eq("user_id", userId)
        .not("extracted_topics", "is", null)
        .limit(100);

      if (topicRows && topicRows.length > 0) {
        const allTopics = new Set<string>();
        for (const row of topicRows) {
          const topics = row.extracted_topics as string[] | null;
          if (topics) {
            for (const t of topics) allTopics.add(t);
          }
        }
        if (allTopics.size > 0) {
          topicVocabulary = Array.from(allTopics).sort().join(", ");
        }
      }
    }

    // Build system (stable, cacheable) + user message (per-call) separately.
    // The system prompt is marked with cache_control so the ~4-10K tokens of
    // extraction instructions are served from cache on subsequent calls
    // (roughly 0.1x the normal input price). See shared/prompt-caching.md.
    const systemPrompt = parseMode === "historical"
      ? buildHistoricalSystemPrompt(userDisplayName)
      : buildActiveSystemPrompt(userDisplayName);

    const userMessage = parseMode === "historical"
      ? buildHistoricalUserMessage({
          userDisplayName,
          attendees: meeting.attendees as string[] | null,
          userContext: typeof user_context === "string" ? user_context : "",
          meetingDateStr,
          meetingDayOfWeek,
          meetingTitle: meeting.title as string,
          transcript,
          topicVocabulary,
          existingMemories,
        })
      : buildActiveUserMessage({
          userDisplayName,
          attendees: meeting.attendees as string[] | null,
          userContext: typeof user_context === "string" ? user_context : "",
          meetingDateStr,
          meetingDayOfWeek,
          meetingTitle: meeting.title as string,
          transcript,
          itemsSummary,
          existingMemories,
        });

    // Call Claude to parse the transcript
    const claudeStart = Date.now();
    const claudeModel = parseMode === "historical" ? "claude-sonnet-4-6" : "claude-opus-4-6";
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Active/real-time parses go to Opus for sharper extraction on a
        // small volume of live meetings. Historical batch stays on Sonnet
        // to keep backfill cost reasonable (770+ meetings × 6x cost).
        model: claudeModel,
        max_tokens: 16384,
        temperature: 0.3,
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", errText);
      return new Response(
        JSON.stringify({
          error: "AI transcript parsing failed",
          detail: errText.substring(0, 1000),
          status: response.status,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiResponse = await response.json();
    const rawContent = aiResponse.content?.[0]?.text ?? "";
    const stopReason = aiResponse.stop_reason;
    const claudeLatencyMs = Date.now() - claudeStart;

    if (stopReason === "max_tokens") {
      console.warn("[ai-parse-transcript] response truncated (max_tokens) for meeting", meeting_id);
    }

    // Durable telemetry — survives Supabase's short log retention so we
    // can actually see cache hit rates and cost over time.
    await recordAiCall(adminClient, {
      user_id: userId,
      function_name: "ai-parse-transcript",
      model: claudeModel,
      usage: aiResponse.usage,
      stop_reason: stopReason ?? null,
      latency_ms: claudeLatencyMs,
      source_type: "meeting",
      source_id: meeting_id,
      metadata: { mode: parseMode },
    });

    // Strip any code fence wrapping the model might have added
    let cleanContent = rawContent.trim();
    if (cleanContent.startsWith("```")) {
      cleanContent = cleanContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(cleanContent);
    } catch (parseErr) {
      console.error("Failed to parse AI response:", parseErr, "Raw:", rawContent);
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response", raw: rawContent.substring(0, 500) }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Auto-rename the meeting if its current title is a placeholder.
    const currentTitle = (meeting.title ?? "").trim();
    const isPlaceholderTitle =
      currentTitle.length === 0 ||
      /^untitled/i.test(currentTitle) ||
      /\.(txt|md|vtt|srt|hda|json)$/i.test(currentTitle) ||
      /^\d{8}[-_]\d{6}/.test(currentTitle);
    const aiTitle =
      typeof parsed.title === "string" && parsed.title.trim().length > 0
        ? parsed.title.trim()
        : null;

    // ============================================================
    // Route to mode-specific post-processing
    // ============================================================
    if (parseMode === "historical") {
      return await handleHistoricalMode(
        adminClient, userId, meeting_id, meeting, parsed,
        currentTitle, isPlaceholderTitle, aiTitle, bodyTranscript
      );
    } else {
      return await handleActiveMode(
        adminClient, userId, userDisplayName, meeting_id, meeting, parsed,
        currentTitle, isPlaceholderTitle, aiTitle, bodyTranscript, anthropicKey
      );
    }
  } catch (err) {
    console.error("Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: message, stack }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// ============================================================
// Prompt builders
//
// Split into a stable `system` prompt (cacheable via cache_control) and a
// per-call `user` message (the variable content). The render order is:
//   tools → system → messages
// so a cache_control marker on the last system block caches everything
// that came before it. Keep anything that varies per call OUT of system.
// ============================================================

interface PromptOpts {
  userDisplayName: string;
  attendees: string[] | null;
  userContext: string;
  meetingDateStr: string;
  meetingDayOfWeek: string;
  meetingTitle: string;
  transcript: string;
}

function buildHistoricalSystemPrompt(userDisplayName: string): string {
  return `You are analyzing a historical meeting transcript. This meeting has already occurred and its outcomes have already played out. Your job is to extract structured information for archival and pattern analysis purposes, not to create actionable tasks.

**The user is ${userDisplayName}.** When you see "${userDisplayName}" (or a clear first-name match) speaking or being addressed in the transcript, that IS the user. He works at EPAM in a senior sales/GTM leadership role focused on partner alliances.

**Date resolution**: The user message will specify the meeting date. When the transcript uses relative date language, resolve against that MEETING date, NOT today's date.

**Attendee attribution**: When the user message provides a known attendee list, use it as your reference for who was in the room. When the transcript has no speaker labels (or only generic "Speaker 1/2/3" labels), combine the attendee list with contextual cues to attribute statements where you can.

Extract the following:

1. **SYNOPSIS**: A structured summary with these exact section headers (use "## " prefix):
   - "## Overview" — one paragraph: who participated, what was discussed, primary outcome
   - "## Key Topics Discussed" — "- " bullet points for main topics with 1-2 sentences each
   - "## Participants & Perspectives" — who said what, key positions and concerns ("- " bullets)
   - "## Outcomes & Next Steps" — what was resolved, what remains open

2. **PARTICIPANTS**: Every person who spoke or was referenced by name. For each:
   - name (as spoken/referenced in the transcript)
   - company (if determinable from context, attendee emails, or discussion content)
   - role (if mentioned or inferable — e.g. "sales lead", "developer", "account manager")
   If calendar metadata shows attendee emails, use those to confirm identities. Map first-name-only references to full names from the attendee list where possible.

3. **DECISIONS**: Specific decisions made. Each with a short title and context/rationale.

4. **OPEN QUESTIONS**: Questions raised but not resolved in this meeting.

5. **COMMITMENTS**: Promises or obligations — both outgoing (${userDisplayName} promised something) and incoming (someone promised something to ${userDisplayName} or his team). For each:
   - title: short summary (5-12 words)
   - description: longer context if helpful
   - direction: "outgoing" if ${userDisplayName} committed, "incoming" if committed TO ${userDisplayName}
   - counterpart: the other party (free text)
   - company: account/client this is about
   - do_by: YYYY-MM-DD if mentioned (resolve relative dates against the meeting date in the user message)
   - evidence_quote: verbatim or close paraphrase from transcript (under 200 chars)
   Only extract explicit commitments — someone clearly saying they will do something. Do not infer from general discussion.

6. **KEY TOPICS**: 3-8 short topic labels that characterize what this meeting was about. Examples: "Adobe partnership pricing", "S&P AEM migration timeline", "team hiring Q1". Keep labels concise and reusable across meetings about the same subject. If the user message provides a previously-seen topic vocabulary, prefer reusing those labels where the same subject recurs.

7. **IDEAS — STRICT CRITERIA**: Strategic ideas worth archiving for ${userDisplayName}'s future reference. BE HIGHLY SELECTIVE. Most meetings produce 0-3 real strategic ideas, not 10-20. Err aggressively on the side of extracting fewer.

   ${userDisplayName}'s role context: Head of Content Go-to-Market at EPAM. Runs partner alliances (Adobe, Sitecore, ContentStack, Contentful, Microsoft) for content management, DAM, and search. E-commerce is NOT his scope — a counterpart owns commerce.

   An item COUNTS as an idea ONLY if ALL are true:
   - It proposes a new strategic approach, offering, GTM motion, positioning angle, or partnership play
   - It is specific enough to be actionable (names a company, approach, or concrete concept — not generic)
   - It is relevant to content GTM (not commerce, not HR, not low-level technical implementation)
   - The originator is clearly identified by name (NOT "Speaker 1", "Speaker 2", "Unknown")
   - It's novel or sharp enough to be worth re-reading in 3 months

   An item does NOT count and MUST be skipped if:
   - The speaker is labeled "Speaker N" or "Unknown" — parser couldn't identify them, likely noise
   - It's a tactical/operational detail (sprint planning, UAT process, internal meeting logistics, resource allocation mechanics)
   - It's out of scope (commerce platforms, HR/learning design, code architecture, low-level devops)
   - It's a generic platitude ("cross-train team", "better collaboration", "use case studies")
   - It's a restatement of what's already being done
   - It's vague ("explore more opportunities", "think about pricing")
   - It's a description of current practice, not a proposal for something new

   When in doubt, skip it. 2 sharp ideas beat 10 fuzzy ones.

   For each qualifying idea:
   - title: clear, descriptive (5-15 words)
   - description: 1-3 sentence summary
   - originated_by: MUST be a real person's name (skip if only a Speaker N label exists)
   - company: what company/account/partner it relates to (null if general)
   - category: one of "gtm_motion", "selling_approach", "partnership", "positioning", "campaign", "bundling", "product", "process", "other"
   - evidence_quote: relevant quote or close paraphrase (under 200 chars)

8. **SUGGESTED TITLE**: 4-10 words, descriptive. Company + topic when both are clear.

9. **DISCUSSION COMPANY**: If the entire discussion is about one company/account, identify it.

9b. **MENTIONED COMPANIES — accounts referenced in the conversation**: Return every distinct organization (client, prospect, partner, vendor, agency, competitor) named in the discussion, *other than* the discussion_company itself and ${userDisplayName}'s own employer. Use case: a partner sync where ${userDisplayName} talks about pitching the partner to several client accounts — those clients belong here even when the meeting's subject is the partner. Cleanest short form ("Walmart", "The Met"), no duplicates, no invented names, no generic "the client" references, no product names that aren't the company itself. Exclude internal-EPAM teams. Empty array is fine.

10. **MEMORIES — STRICT CRITERIA**: Durable facts worth writing to long-term memory so future AI calls know them without re-discovery. BE CONSERVATIVE — 0-3 memories per meeting is typical.

    A memory COUNTS only if ALL are true:
    - It's a stable fact likely to still be true in 3 months (role, relationship, preference, responsibility, team membership, stated opinion on recurring topic).
    - It's about a named person, company, or ${userDisplayName} personally.
    - It's novel — not already in the "Existing memories" list in the user message. Do NOT re-emit facts already there (even if worded differently).
    - It's one atomic sentence (under 140 chars).

    A memory does NOT count and MUST be skipped if:
    - It's a one-off event from this meeting ("Holly was out sick"). Those are transient.
    - It's an action item, decision, or commitment — those go in their own fields.
    - It's a "could / might / thinking about" — memories are asserted facts, not possibilities.
    - It's generic ("Chanel is a company", "Holly is a person").
    - It's speculative or unverified from the transcript.

    Examples:
    - ✓ COUNT — "Holly Quinones is the procurement contact at Chanel"
    - ✓ COUNT — "${userDisplayName} prefers morning meetings before 11am ET"
    - ✓ COUNT — "S&P requires a 2-week lead for any SOW amendment"
    - ✗ SKIP — "Discussed pricing with Holly today" (event, not fact)
    - ✗ SKIP — "Might follow up next week" (speculative)

    For each memory return: { "content": "the atomic fact sentence" }

Respond with ONLY valid JSON (no markdown wrapping, no code fences). Schema:
{
  "summary": "string (markdown synopsis)",
  "title": "string",
  "company": "string or null",
  "mentioned_companies": ["string"],
  "participants": [
    {"name": "string", "company": "string or null", "role": "string or null"}
  ],
  "decisions": [
    {"decision": "string", "context": "string"}
  ],
  "open_questions": [
    {"question": "string", "owner": "string or null"}
  ],
  "commitments": [
    {
      "title": "string",
      "description": "string or null",
      "direction": "outgoing|incoming",
      "counterpart": "string or null",
      "company": "string or null",
      "do_by": "YYYY-MM-DD or null",
      "evidence_quote": "string"
    }
  ],
  "topics": ["string"],
  "ideas": [
    {
      "title": "string",
      "description": "string",
      "originated_by": "string or null",
      "company": "string or null",
      "category": "string",
      "evidence_quote": "string"
    }
  ],
  "memories": [
    {"content": "atomic durable fact, under 140 chars"}
  ]
}`;
}

function buildHistoricalUserMessage(opts: PromptOpts & { topicVocabulary: string; existingMemories: string }): string {
  const attendeeBlock = opts.attendees && opts.attendees.length > 0
    ? `\n**Known meeting attendees**: ${opts.attendees.join(", ")}`
    : "";

  const topicHint = opts.topicVocabulary
    ? `\n**Previously seen topics** (prefer reusing these labels where the same subject recurs): ${opts.topicVocabulary}`
    : "";

  const memoriesBlock = opts.existingMemories
    ? `\n**Existing memories** (do NOT re-emit these or rewordings of them):\n${opts.existingMemories}`
    : "";

  const userContextBlock = opts.userContext ? `\n${opts.userContext}` : "";

  return `**Meeting date**: ${opts.meetingDateStr}${opts.meetingDayOfWeek ? ` (a ${opts.meetingDayOfWeek})` : ""}${attendeeBlock}${topicHint}${memoriesBlock}${userContextBlock}

Discussion title: "${opts.meetingTitle}"

Content:
${opts.transcript}`;
}

function buildActiveSystemPrompt(userDisplayName: string): string {
  return `You are analyzing a discussion transcript or notes. The content may be in any format: raw text, timestamped notes, VTT/SRT subtitles, or structured meeting notes. Handle all formats gracefully.

**The user uploading this transcript is ${userDisplayName}.** When you see "${userDisplayName}" (or a clear first-name match) speaking or being addressed in the transcript, that IS the user.

**Detect solo time-blocks first.** Many people block time on their calendar to do focused work — "Review S&P," "Work on IDC Deck," "Send Adobe Emails." If you read the transcript / notes and conclude this is just ${userDisplayName} working alone (single speaker, voice memo style, monologue, no second party addressed) AND/OR the meeting has only ${userDisplayName} on the attendee list, treat it as a personal time-block, NOT a meeting:
- DO extract: synopsis (what they worked on), memories (durable facts), ideas (concepts they articulated)
- DO NOT extract: action_items (these are inter-personal commitments by definition), commitments (definitionally to other people), follow_ups (definitionally external touches), open_questions assigned to others
- Set the synopsis to reflect the work-block nature: "${userDisplayName} used this block to..." rather than narrating it as a discussion
- Return empty arrays for action_items, commitments, follow_ups, open_questions
This is a common pattern; don't try to invent inter-personal artifacts from a solo block.

**Attendee attribution**: When the user message provides a known attendee list, use it as your reference for who was in the room. When the transcript has no speaker labels (or only generic "Speaker 1/2/3" labels), use the attendee list and contextual cues — names mentioned, people addressed directly, "as you said" references — to attribute statements to specific people where you can. If you cannot tell who said something, mark it as "unknown" rather than guessing.

**Extraction philosophy**: Capture ALL real action items regardless of who they belong to. Do NOT drop items just because they're not assigned to ${userDisplayName} — better to surface a few items that turn out to be for someone else than to miss real commitments because attribution was unclear. The user will triage in the review queue.

**Date resolution**: The user message will specify the meeting date. When the transcript uses relative date language ("tomorrow", "next week", "by Friday", "end of month"), resolve it against the MEETING date — NOT against the date you're processing this transcript. "Tomorrow" in a meeting on April 2nd means April 3rd, regardless of when the parse runs.

Extract these elements:

1. Synopsis: A structured summary with these exact section headers (use "## " prefix for headers, plain prose otherwise — do NOT use **bold** or *italic* markers in the body text):
   - "## Overview" — one paragraph: who participated, what was discussed, primary outcome
   - "## Key Topics Discussed" — use "- " bullet points for main topics with 1-2 sentences of context each
   - "## Participants & Perspectives" — who said what, key positions and concerns (use "- " bullets per participant)
   - "## Outcomes & Next Steps" — what was resolved, what remains open, what happens next

2. **Action Items — STRICT CRITERIA**: Only extract items that are real commitments to act, not topics that were merely discussed. Be conservative on what counts as a real commitment, but be GENEROUS about including items regardless of who owns them.

   An item COUNTS as an action item ONLY if it meets at least one of these:
   - A person explicitly committed to do something with first-person language: "I'll send X", "I'm going to fix Y", "Let me grab that", "I'll follow up"
   - Someone was explicitly assigned a task and accepted it: "Can you handle X?" → "Yeah, I'll take care of it"
   - A specific, named, actionable next step was assigned to a specific owner

   An item does NOT count and MUST be skipped if it is:
   - A topic discussed without commitment: "We should think about X", "It would be nice if Y", "We could maybe do Z"
   - A hypothetical or aspirational statement: "Maybe we", "What if we", "In a perfect world"
   - Background context, history, or status updates: "We talked about X last week", "X is going well"
   - An open question without an assigned owner — those go in open_questions, NOT action_items
   - A decision that was made — those go in decisions, NOT action_items
   - A general capability or wish: "Eventually we want to have X"
   - **Attending or joining a meeting that was already discussed as scheduled.** The calendar is the system of record for events; Resurface does not need a task to "show up." BUT: work that RESULTS in a meeting — scheduling, confirming, rescheduling, sending the invite, coordinating logistics, preparing materials specifically for it — DOES count.

   Examples:
   - ✓ COUNT — "I'll have the deck to you by Friday" → explicit commitment by speaker
   - ✓ COUNT — "Holly: Can you review the contract?" "Yeah, I'll get to it tomorrow" → explicit accepted assignment to whoever said yes
   - ✓ COUNT — "Tom is going to update the spreadsheet by Wednesday" → explicit commitment by Tom
   - ✓ COUNT — "I'll reach out to Alice to set up a call next week" → scheduling work, the email/outreach is the action
   - ✓ COUNT — "Let me put time on your calendar for Thursday" → scheduling action by speaker
   - ✗ SKIP — "We should probably revisit pricing at some point" → speculative, no commitment
   - ✗ SKIP — "It would be great if marketing could help with this" → aspirational, no commitment
   - ✗ SKIP — "We talked about needing better dashboards" → discussion topic, no actor or commitment
   - ✗ SKIP — "What about doing a roadshow next quarter?" → hypothetical question
   - ✗ SKIP — "See you Thursday at 3" / "I'll be at the summit next week" → meeting attendance, calendar handles it
   - ✗ SKIP — "Let's sync again after the demo" → vague recurrence, not a concrete scheduling action

   For each real action item, return:
   - **commitment_strength**: "explicit" (direct verbal commitment with clear actor and verb) | "implied" (strong implication but not stated directly, e.g. someone restates a plan they're owning). Do NOT return items weaker than "implied" — those are not action items, they are topics.
   - **assignee**: Best-effort attribution. Use one of:
     - **"user"** — if the action clearly belongs to ${userDisplayName} (e.g. ${userDisplayName} is the speaker stating their own commitment, or someone explicitly hands the task to ${userDisplayName})
     - **"<person's name>"** — if you can identify a specific other person who owns the action (use the attendee list when available)
     - **"unknown"** — when you can tell something was committed but you genuinely cannot determine who said it (common when transcripts have no speaker labels)
   - Whatever the assignee, INCLUDE THE ITEM. Do not drop items because attribution is uncertain. The user will triage manually.
   - **evidence_quote**: A short verbatim quote from the transcript (under 200 chars) that directly supports this being a real commitment. This is the actual sentence where the commitment was made. If you cannot point to a quote, the item is not real and you should drop it.
   - Assign urgency (high/medium/low)
   - **Suggest a due date** (YYYY-MM-DD format) ONLY if the transcript mentions a specific deadline, timeframe ("by end of week", "next month"), or implies urgency. **Use the meeting date (from the user message) as the reference for resolving any relative date language**, NOT today's date. If no due date is implied, use null.
   - **Identify the company / account / client** this task is about, if applicable. Look at the discussion title (e.g. "S&P pricing call", "Adobe HCLS - Follow up", "Acme Corp standup") and the content for an org name. Use the cleanest short form (e.g. "Adobe", "S&P", "Acme Corp"). If the task is internal-only or no company is mentioned, use null. Do NOT invent company names. **If the discussion is clearly about a single company, set the company field on EVERY action item to that company name** — don't leave action items blank just because the company isn't repeated in that specific bullet.

3. **Decisions**: Things that were decided/agreed upon

4. **Open Questions**: Unresolved items that need follow-up

5. **Commitments — OUTGOING SOFT OBLIGATIONS**: Things ${userDisplayName} acknowledged owing or agreed to do, where the obligation is **relational or social** rather than a clean deliverable. These often slip because they're not formal tasks at the moment they happen.

   Extract a commitment ONLY if ALL of these are true:
   - ${userDisplayName} is the one making the commitment (it goes FROM the user TO someone else — outgoing only, never incoming)
   - The statement is verbatim from the user's mouth or is a clear paraphrase of something the user said
   - It is a real obligation, not banter or hypothetical

   Things that COUNT as commitments:
   - "I owe him one" / "I owe you for that"
   - "I'll get back to you next week"
   - "Let me follow up with you on that"
   - "I'll think about it and circle back"
   - "I'll make sure that gets done"
   - Acknowledgments of prior promises being remembered
   - Soft promises with vague timing ("soon", "this week", "by end of month")

   Things that do NOT count and MUST be skipped:
   - Specific deliverable tasks with a clear thing to do — those go in action_items, NOT commitments
   - Things OTHER people committed to (incoming obligations) — outgoing only for now
   - Speculative or aspirational ("we should follow up sometime")
   - General statements of intent without a specific counterpart
   - Things the user explicitly declined or pushed back on

   The distinction from action_items: an action_item is a clean deliverable ("send the deck by Friday"). A commitment is a social/relational obligation that may not have a clean deliverable ("I'll follow up", "I owe him one"). When in doubt — if there's a clear thing to deliver, it's an action_item. If it's a fuzzy social promise, it's a commitment. Some statements may legitimately be both — that's fine, return both.

   For each commitment, return:
   - **title**: short summary of what was committed (5–12 words)
   - **description**: longer context if helpful
   - **counterpart**: the person ${userDisplayName} made the promise TO (free text — e.g. "Holly", "the procurement team"). null if unclear.
   - **company**: the account/client this is about, same rules as action items
   - **do_by**: YYYY-MM-DD if a date is mentioned or strongly implied. **This is the primary date.** Resolve any relative dates ("next week", "by Friday", "tomorrow") against the MEETING date (from the user message), NOT today. If only a vague timing is given ("soon", "this week"), still try — be best-effort. null only if there's truly no temporal signal at all.
   - **promised_by**: usually the same as do_by; only set differently if the user said "I told them by X but I need it ready by Y"
   - **needs_review_by**: only if explicitly mentioned ("I need someone to review it before X")
   - **evidence_quote**: verbatim from the transcript, the line where the user made the commitment
   - **ambiguity_flags**: array, any of: "social_language", "relative_date", "external_dependency", "ambiguous_actionability", "no_counterpart"

6. **Duplicate detection (suggest_merge_item_id)**: For each action item, check against the "Current open items" list in the user message. If the new action item clearly refers to the same underlying work as an existing item (same task, same deliverable, same client context), set suggest_merge_item_id to that item's full UUID (copy it directly from the id= field in the items list). Be conservative — only suggest a merge when you're confident it's the same thing, not just topically related. When in doubt, leave it null.

7. **References**: Match against existing work items where applicable

7. **Discussion Company**: At the top level, if the entire discussion is about one company/account, identify it. Same rules as above — only use a name that's clearly present.

7b. **Mentioned Companies — accounts referenced in the conversation**: Return a list of every distinct organization (client, prospect, partner, vendor, agency, competitor) that comes up by name in the discussion, *other than* the discussion_company itself and ${userDisplayName}'s own employer. The use case: a partner sync where ${userDisplayName} talks about pitching the partner to several client accounts — those clients should be captured here even though the meeting's subject is the partner.

   STRICT criteria:
   - Must be a real organization name spoken or written in the transcript. No invention.
   - Use the cleanest short form ("Walmart", "The Met", "Mayo Clinic"), case as commonly written.
   - Exclude generic references ("the client", "their team") that aren't tied to a name.
   - Exclude product names that aren't the company itself ("Photoshop" — skip; "Adobe" — keep).
   - Exclude the meeting's primary subject (already in discussion_company).
   - Exclude internal-EPAM teams.
   - Exclude duplicates and near-duplicates ("Walmart" + "Walmart Inc" → one entry).
   - Empty array is fine. Don't reach for items just to fill it.

8. **Suggested Title**: A short, descriptive title for this discussion, suitable as a meeting name. Aim for 4–10 words. Use the cleanest, most identifying form. Examples: "Adobe AEM cloud migration kickoff", "S&P pricing review with Holly", "Q3 planning standup". Avoid generic titles like "Meeting" or "Discussion". Capture the company and the topic when both are clear.

9. **Memories — STRICT CRITERIA**: Durable facts worth persisting to long-term memory so future AI calls know them without re-discovery. BE CONSERVATIVE — 0-3 memories per meeting is typical.

   A memory COUNTS only if ALL are true:
   - It's a stable fact likely to still be true in 3 months (role, relationship, preference, responsibility, team membership, stated opinion on recurring topic).
   - It's about a named person, company, or ${userDisplayName} personally.
   - It's novel — not already in the "Existing memories" list in the user message. Do NOT re-emit facts already there (even if worded differently).
   - It's one atomic sentence (under 140 chars).

   A memory does NOT count and MUST be skipped if:
   - It's a one-off event from this meeting ("Holly was out sick"). Those are transient.
   - It's an action item, decision, or commitment — those go in their own fields.
   - It's a "could / might / thinking about" — memories are asserted facts, not possibilities.
   - It's generic ("Chanel is a company", "Holly is a person").
   - It's speculative or unverified from the transcript.

   For each memory return: { "content": "the atomic fact sentence" }

10. **Follow-Ups — POST-MEETING RELATIONAL TOUCHES**: A follow-up is the short message ${userDisplayName} would normally send right after a meeting — "thanks Beth, I appreciate the time. I'll work with the team and get those numbers for you." This is distinct from action items (which are the work itself) and commitments (which span weeks and have deliverables). A follow-up is the *acknowledgment* that the work exists, the relational closing move that gets dropped when ${userDisplayName} is in back-to-back meetings.

   **DEFAULT: GENERATE a follow-up whenever the meeting includes ANY external attendee** — anyone who is not on ${userDisplayName}'s team / not at ${userDisplayName}'s company. External = client, prospect, partner, vendor, agency, or any outside party. This is the most common case. **When in doubt, generate one.** ${userDisplayName} can dismiss it in two clicks if it isn't needed; missing one is the costly failure mode.

   1:1s with a single external person ALMOST ALWAYS warrant a follow-up. Don't skip them just because the meeting was small. Don't skip them just because the conversation was friendly. Don't skip them just because no specific deliverable was promised. The relational closing move ("thanks, talk soon, I'll follow up on X") is the entire point of this feature — it's most needed exactly when ${userDisplayName} is depleted from a back-to-back day and would otherwise drop the touch.

   ONLY skip the follow-up when the meeting clearly meets one of these:
   - Every attendee is internal (no external party present at all). To check: scan the attendee list and the transcript for any name that doesn't sound like a teammate at ${userDisplayName}'s company.
   - It's a routine internal standup, status sync, retro, or team check-in (purely internal cadence)
   - The meeting was extremely brief (under ~5 minutes of real conversation) AND purely transactional — e.g., a quick scheduling confirmation with nothing else discussed.

   If you skip, briefly note why in the summary's Outcomes section so the user knows the parser didn't simply forget.

   **A follow-up is ONE EMAIL**, with one subject, one body, and a To list of all the relevant external attendees. Not N parallel emails to N people. The greeting names everyone on the To list.

   **Recipients — INCLUDE ALL RELEVANT EXTERNAL ATTENDEES.** This is one email; the To list reflects who's on the email. Include every external attendee who participated meaningfully or is part of the ongoing relationship. Exclude pure note-takers / silent observers if they clearly added nothing and aren't part of the working relationship, but err on the side of including them; ${userDisplayName} can remove names before sending.

   NEVER include ${userDisplayName} as a recipient. NEVER include attendees from ${userDisplayName}'s own team unless they specifically warrant being on the email (rare).

   **Greeting — match ${userDisplayName}'s actual habit:**
   - 1 recipient: "Hey Justin," or "Justin," (first name only)
   - 2 or 3 recipients: name them all. "Hey Justin, Dyana, and Sean," or "Justin and Ethan,"
   - 4+ recipients: "Hey All," or "All,"

   The greeting goes on its own line, followed by a blank line, then the body.

   **Multiple follow_up entries — almost never.** A meeting produces AT MOST ONE follow_up entry. The rare exception: people from two different external organizations on the same call who genuinely need different content. Even then, prefer one email if the message would be the same. NEVER emit multiple follow_up entries for same-company teammates.

   **Body writing**: 3–6 sentences. Warm, direct, professional, not overly formal. Mention what was discussed, what ${userDisplayName} owes the group next, and (if natural) one specific thing from the conversation that shows ${userDisplayName} was paying attention. Do NOT invent details that aren't in the transcript. End with "Regards," on its own line, then a blank line where the signature would go.

   **Acknowledge gaps honestly.** If ${userDisplayName} committed in the meeting to find / look up / locate something but you have no evidence in the transcript that they actually have it, the draft should reflect reality, not pretend. Example: if they said "I'll send the business plan" but the transcript doesn't show them having it, write "I went looking but couldn't find it on my side, could you send it over?" instead of pretending it's attached. Mirror ${userDisplayName}'s honest voice.

   **Include one explicit ask when there is one.** Real follow-ups often need something from the recipient(s) to move forward (a document, a calendar slot, a confirmation, an introduction). If the meeting surfaces a clear thing ${userDisplayName} needs from the group, include one direct ask. Don't manufacture asks where there aren't any.

   **Writing rules — these matter, the user can spot AI-isms:**
   - **NO em dashes (—).** None. Use a period, comma, or "and" instead. This is the single most common AI tell.
   - **NO colons followed by a punchy / pithy statement.** Patterns like "The result: a stronger relationship." or "Here's the thing: it works." or "What stood out: the candor." are AI tells. Use a normal sentence instead.
   - **NO "it's not just X, it's Y" constructions.** Another AI tell.
   - **Avoid triadic lists with rhetorical rhythm** ("clear, focused, and decisive"). One adjective is usually enough.
   - **Avoid the words** "delve", "leverage", "robust", "seamless", "navigate" (as a verb for non-physical things), "ensure" (when you mean "make sure"), and "moreover/furthermore" (use "also" or just start a new sentence).
   - Write the way ${userDisplayName} would actually type a quick email after a meeting: short sentences, occasional contractions, one paragraph break if needed, no rhetorical flourishes.

   For each follow-up return:
   - **rationale**: one short sentence explaining why this meeting warrants a follow-up
   - **evidence_quote**: a short verbatim line from the transcript that anchors the follow-up (under 200 chars)
   - **draft_subject**: ONE shared subject line (under 80 chars)
   - **draft_body**: ONE shared body, including the greeting that names everyone on the To list and the "Regards," signoff
   - **recipients**: array of objects, each with:
     - **name**: recipient's first name (or first + last if both known)
     - **email**: email if you can determine it from the transcript or attendee list, else null
     - **rationale**: one short sentence — why this person is on the email

Respond with ONLY valid JSON (no markdown wrapping, no code fences). Schema:
{
  "summary": "<the markdown synopsis as a single string>",
  "title": "string (4-10 words, descriptive)",
  "company": "string or null",
  "mentioned_companies": ["string"],
  "action_items": [
    {
      "title": "string",
      "description": "string",
      "commitment_strength": "explicit|implied",
      "evidence_quote": "string (verbatim from transcript, under 200 chars)",
      "company": "string or null",
      "assignee": "user|name|unknown",
      "urgency": "high|medium|low",
      "suggested_due_date": "YYYY-MM-DD or null",
      "suggest_merge_item_id": "full UUID from itemsSummary if this clearly duplicates an existing item, otherwise null",
      "related_item_ids": ["string"]
    }
  ],
  "decisions": [
    {"decision": "string", "context": "string"}
  ],
  "open_questions": [
    {"question": "string", "owner": "user|name|unknown"}
  ],
  "commitments": [
    {
      "title": "string",
      "description": "string",
      "counterpart": "string or null",
      "company": "string or null",
      "do_by": "YYYY-MM-DD or null",
      "promised_by": "YYYY-MM-DD or null",
      "needs_review_by": "YYYY-MM-DD or null",
      "evidence_quote": "string (verbatim, under 200 chars)",
      "ambiguity_flags": ["string"]
    }
  ],
  "memories": [
    {"content": "atomic durable fact, under 140 chars"}
  ],
  "follow_ups": [
    {
      "rationale": "string (one sentence, why this meeting needs a follow-up)",
      "evidence_quote": "string (verbatim, under 200 chars)",
      "draft_subject": "string (under 80 chars, ONE shared subject)",
      "draft_body": "string (ONE shared body, includes greeting naming everyone + 'Regards,' signoff)",
      "recipients": [
        {
          "name": "string (first name, or first + last)",
          "email": "string or null",
          "rationale": "string (one sentence, why this person is on the email)"
        }
      ]
    }
  ]
}`;
}

function buildActiveUserMessage(opts: PromptOpts & { itemsSummary: string; existingMemories: string }): string {
  const attendeeBlock = opts.attendees && opts.attendees.length > 0
    ? `\n**Known meeting attendees**: ${opts.attendees.join(", ")}`
    : "";

  const memoriesBlock = opts.existingMemories
    ? `\n**Existing memories** (do NOT re-emit these or rewordings of them):\n${opts.existingMemories}`
    : "";

  const userContextBlock = opts.userContext ? `\n${opts.userContext}` : "";

  return `**Meeting date**: ${opts.meetingDateStr}${opts.meetingDayOfWeek ? ` (a ${opts.meetingDayOfWeek})` : ""}${attendeeBlock}${memoriesBlock}${userContextBlock}

Current open items for cross-reference:
${opts.itemsSummary}

Discussion title: "${opts.meetingTitle}"

Content:
${opts.transcript}`;
}

// ============================================================
// Historical mode post-processing
// ============================================================

async function handleHistoricalMode(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  meetingId: string,
  meeting: Record<string, unknown>,
  parsed: Record<string, unknown>,
  currentTitle: string,
  isPlaceholderTitle: boolean,
  aiTitle: string | null,
  bodyTranscript: unknown,
) {
  const discussionCompany: string | null =
    typeof parsed.company === "string" && parsed.company.trim().length > 0
      ? parsed.company.trim()
      : null;

  // One resolver per request — preloads people+companies once so all
  // per-participant / per-commitment / per-idea resolves run from cache.
  const resolver = createIdentityResolver(adminClient, userId);

  // Update meeting record
  const meetingUpdate: Record<string, unknown> = {
    ...(typeof bodyTranscript === "string" && (bodyTranscript as string).length >= 100
      ? { transcript: bodyTranscript }
      : {}),
    transcript_summary: parsed.summary,
    extracted_action_items: [],
    extracted_decisions: parsed.decisions ?? [],
    extracted_open_questions: parsed.open_questions ?? [],
    extracted_topics: parsed.topics ?? [],
    mentioned_companies: cleanMentionedCompanies(parsed.mentioned_companies, discussionCompany),
    processed_at: new Date().toISOString(),
  };
  if (isPlaceholderTitle && aiTitle) {
    meetingUpdate.title = aiTitle;
  }
  await adminClient.from("meetings").update(meetingUpdate).eq("id", meetingId);

  // Clean up any stale pending proposals from prior parses
  await adminClient
    .from("proposals")
    .delete()
    .eq("user_id", userId)
    .eq("source_type", "meeting")
    .eq("source_id", meetingId)
    .eq("status", "pending");

  // ----- Participant resolution -----
  const participants = (parsed.participants ?? []) as Array<{
    name?: string;
    company?: string | null;
    role?: string | null;
  }>;

  let participantsLinked = 0;
  for (const p of participants) {
    if (!p.name || !p.name.trim()) continue;
    // Skip the user themselves
    const nameLower = p.name.trim().toLowerCase();
    if (
      nameLower === (meeting.user_id as string) ||
      nameLower === "the user" ||
      nameLower === "user"
    ) continue;

    try {
      // Resolve company first if provided
      let companyId: string | undefined;
      const companyName = p.company ?? discussionCompany;
      if (companyName) {
        try {
          companyId = await resolver.resolveCompany(companyName);
        } catch { /* non-fatal */ }
      }

      const personId = await resolver.resolvePerson({
        raw: p.name.trim(),
        companyId,
      });

      // Update role if we have one and the person doesn't already
      if (p.role) {
        await adminClient
          .from("people")
          .update({ role: p.role })
          .eq("id", personId)
          .is("role", null);
      }

      // Link to meeting_attendees
      await adminClient
        .from("meeting_attendees")
        .upsert(
          { meeting_id: meetingId, person_id: personId },
          { onConflict: "meeting_id,person_id" }
        );

      participantsLinked++;
    } catch (err) {
      console.warn(`[historical-parse] participant resolution failed for "${p.name}":`, err);
    }
  }

  // ----- Historical commitments -----
  const commitments = (parsed.commitments ?? []) as Array<{
    title?: string;
    description?: string | null;
    direction?: string;
    counterpart?: string | null;
    company?: string | null;
    do_by?: string | null;
    evidence_quote?: string | null;
  }>;

  let commitmentsCreated = 0;
  for (const c of commitments) {
    if (!c.title?.trim()) continue;
    const company = c.company ?? discussionCompany;
    try {
      await adminClient.from("commitments").insert({
        user_id: userId,
        title: prefixWithCompany(c.title, company),
        description: c.description ?? null,
        counterpart: c.counterpart ?? null,
        company: company,
        do_by: c.do_by ?? null,
        status: "historical",
        direction: c.direction === "incoming" ? "incoming" : "outgoing",
        source_meeting_id: meetingId,
        evidence_text: c.evidence_quote ?? null,
        confidence: 0.6,
      });
      commitmentsCreated++;
    } catch (err) {
      console.warn(`[historical-parse] commitment insert failed:`, err);
    }
  }

  // ----- Ideas -----
  const ideas = (parsed.ideas ?? []) as Array<{
    title?: string;
    description?: string | null;
    originated_by?: string | null;
    company?: string | null;
    category?: string;
    evidence_quote?: string | null;
  }>;

  let ideasCreated = 0;
  for (const idea of ideas) {
    if (!idea.title?.trim()) continue;
    const companyName = idea.company ?? discussionCompany;

    // Try to resolve company_id
    let companyId: string | null = null;
    if (companyName) {
      try {
        companyId = await resolver.resolveCompany(companyName);
      } catch { /* store name only */ }
    }

    try {
      await adminClient.from("ideas").insert({
        user_id: userId,
        title: idea.title.trim(),
        description: idea.description ?? null,
        evidence_text: idea.evidence_quote ?? null,
        source_meeting_id: meetingId,
        originated_by: idea.originated_by ?? null,
        company_id: companyId,
        company_name: companyName,
        category: idea.category ?? "other",
        status: "surfaced",
      });
      ideasCreated++;
    } catch (err) {
      console.warn(`[historical-parse] idea insert failed:`, err);
    }
  }

  // Memories — parser-extracted durable facts, written directly to the
  // memories table (no proposal-queue round trip). Dedupes case-insensitively.
  const memoriesCreated = await insertExtractedMemories(
    adminClient,
    userId,
    (parsed as { memories?: unknown }).memories
  );

  return new Response(
    JSON.stringify({
      ...parsed,
      title: meetingUpdate.title ?? currentTitle,
      mode: "historical",
      proposals_created: 0,
      commitments_created: commitmentsCreated,
      ideas_created: ideasCreated,
      memories_created: memoriesCreated,
      participants_linked: participantsLinked,
      topics: parsed.topics ?? [],
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

// ============================================================
// Active mode post-processing (original behavior)
// ============================================================

async function handleActiveMode(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  userDisplayName: string,
  meetingId: string,
  meeting: Record<string, unknown>,
  parsed: Record<string, unknown>,
  currentTitle: string,
  isPlaceholderTitle: boolean,
  aiTitle: string | null,
  bodyTranscript: unknown,
  anthropicKey: string,
) {
  const discussionCompany: string | null =
    typeof parsed.company === "string" && parsed.company.trim().length > 0
      ? parsed.company.trim()
      : null;

  // Update the meeting with parsed data.
  const meetingUpdate: Record<string, unknown> = {
    ...(typeof bodyTranscript === "string" && (bodyTranscript as string).length >= 100
      ? { transcript: bodyTranscript }
      : {}),
    transcript_summary: parsed.summary,
    extracted_action_items: [],
    extracted_decisions: parsed.decisions ?? [],
    extracted_open_questions: parsed.open_questions ?? [],
    mentioned_companies: cleanMentionedCompanies(parsed.mentioned_companies, discussionCompany),
    processed_at: new Date().toISOString(),
  };
  if (isPlaceholderTitle && aiTitle) {
    meetingUpdate.title = aiTitle;
  }
  await adminClient
    .from("meetings")
    .update(meetingUpdate)
    .eq("id", meetingId);

  // Re-parse safety: clear any pending proposals from this meeting before
  // regenerating. Reviewed proposals are preserved.
  await adminClient
    .from("proposals")
    .delete()
    .eq("user_id", userId)
    .eq("source_type", "meeting")
    .eq("source_id", meetingId)
    .eq("status", "pending");

  // Same idea for follow-ups: clear any pending (un-acted-on) follow-ups for
  // this meeting before regenerating. Sent and dismissed follow-ups stay.
  await adminClient
    .from("follow_ups")
    .delete()
    .eq("user_id", userId)
    .eq("source_meeting_id", meetingId)
    .eq("status", "pending");

  const actionItems = (parsed.action_items ?? []) as Array<{
    title?: string;
    description?: string;
    commitment_strength?: "explicit" | "implied" | "speculative";
    evidence_quote?: string | null;
    company?: string | null;
    assignee?: string;
    urgency?: string;
    suggested_due_date?: string | null;
    suggest_merge_item_id?: string | null;
    related_item_ids?: string[];
  }>;

  type ProposalInsert = {
    user_id: string;
    proposal_type: string;
    source_type: string;
    source_id: string;
    evidence_text: string | null;
    normalized_payload: Record<string, unknown>;
    confidence: number | null;
    ambiguity_flags: string[];
    suggested_merge_target_id?: string | null;
  };

  function normalizeName(s: string): string {
    return s
      .toLowerCase()
      .replace(/[._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  const userNameNorm = normalizeName(userDisplayName);
  const userTokens = userNameNorm.split(" ").filter((t) => t.length >= 2);
  const userFirstToken = userTokens[0] ?? "";

  function isUserAssignee(assignee: string | undefined | null): boolean {
    if (!assignee) return false;
    const raw = assignee.trim().toLowerCase();
    if (raw === "user") return true;
    if (raw === "unknown") return false;
    const norm = normalizeName(assignee);
    if (norm === userNameNorm) return true;
    if (userFirstToken.length >= 3 && norm === userFirstToken) return true;
    const assigneeTokens = norm.split(" ").filter((t) => t.length >= 2);
    if (
      assigneeTokens.length > 0 &&
      assigneeTokens.every((t) => userTokens.includes(t))
    ) {
      return true;
    }
    return false;
  }

  const titledActionItems = actionItems.filter(
    (a) => typeof a?.title === "string" && a.title.trim().length > 0
  );
  const realCommitments = titledActionItems.filter(
    (a) => a.commitment_strength !== "speculative"
  );
  const skippedSpeculative = titledActionItems.length - realCommitments.length;
  const allActionItems = realCommitments;
  const notForUser = allActionItems.filter((a) => !isUserAssignee(a.assignee)).length;

  const proposalRows: ProposalInsert[] = allActionItems.map((a) => {
    const flags: string[] = [];
    if (!a.suggested_due_date) {
      flags.push("no_due_date");
    }
    if (a.commitment_strength === "implied") {
      flags.push("implied_commitment");
    }

    const baseConfidence = a.commitment_strength === "implied" ? 0.55 : 0.75;
    const company = a.company ?? discussionCompany;
    const evidenceQuote =
      typeof a.evidence_quote === "string" && a.evidence_quote.trim().length > 0
        ? a.evidence_quote.trim()
        : null;

    // Only accept merge suggestion if it's a well-formed UUID
    const mergeId =
      typeof a.suggest_merge_item_id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.suggest_merge_item_id)
        ? a.suggest_merge_item_id
        : null;

    return {
      user_id: userId,
      proposal_type: "task",
      source_type: "meeting",
      source_id: meetingId,
      evidence_text: evidenceQuote,
      normalized_payload: {
        title: prefixWithCompany(a.title, company),
        description: a.description ?? "",
        due_date: a.suggested_due_date ?? null,
        company,
        assignee: a.assignee ?? null,
        urgency: a.urgency ?? null,
        commitment_strength: a.commitment_strength ?? null,
        source_meeting_id: meetingId,
      },
      confidence: baseConfidence,
      ambiguity_flags: flags,
      suggested_merge_target_id: mergeId,
    };
  });

  // Commitment proposals
  const rawCommitments = (parsed.commitments ?? []) as Array<{
    title?: string;
    description?: string;
    counterpart?: string | null;
    company?: string | null;
    do_by?: string | null;
    promised_by?: string | null;
    needs_review_by?: string | null;
    evidence_quote?: string | null;
    ambiguity_flags?: string[];
  }>;

  const commitmentRows: ProposalInsert[] = rawCommitments
    .filter((c) => typeof c?.title === "string" && c.title.trim().length > 0)
    .map((c) => {
      const flags: string[] = Array.isArray(c.ambiguity_flags) ? [...c.ambiguity_flags] : [];
      if (!c.do_by && !c.promised_by) {
        if (!flags.includes("relative_date")) flags.push("relative_date");
      }
      if (!c.counterpart && !flags.includes("no_counterpart")) {
        flags.push("no_counterpart");
      }

      const evidenceQuote =
        typeof c.evidence_quote === "string" && c.evidence_quote.trim().length > 0
          ? c.evidence_quote.trim()
          : null;

      const company = c.company ?? discussionCompany;

      return {
        user_id: userId,
        proposal_type: "commitment",
        source_type: "meeting",
        source_id: meetingId,
        evidence_text: evidenceQuote,
        normalized_payload: {
          title: prefixWithCompany(c.title, company),
          description: c.description ?? "",
          counterpart: c.counterpart ?? null,
          company,
          do_by: c.do_by ?? null,
          promised_by: c.promised_by ?? null,
          needs_review_by: c.needs_review_by ?? null,
          source_meeting_id: meetingId,
        },
        confidence: 0.6,
        ambiguity_flags: flags,
      };
    });

  const allProposalRows = [...proposalRows, ...commitmentRows];

  // Validate proposal shape before writing
  const VALID_PROPOSAL_TYPES = ["task", "commitment", "memory", "draft", "deadline_adjustment"];
  const VALID_SOURCE_TYPES = ["meeting", "transcript", "chat", "manual", "reconciliation"];

  const validatedRows = allProposalRows.filter((row) => {
    const payload = row.normalized_payload as Record<string, unknown>;
    if (typeof payload?.title !== "string" || !payload.title.trim()) {
      console.warn("[parser-validation] skipping proposal: missing title", JSON.stringify(row).substring(0, 200));
      return false;
    }
    if (!VALID_PROPOSAL_TYPES.includes(row.proposal_type as string)) {
      console.warn("[parser-validation] skipping proposal: invalid type", row.proposal_type);
      return false;
    }
    if (!VALID_SOURCE_TYPES.includes(row.source_type as string)) {
      console.warn("[parser-validation] skipping proposal: invalid source_type", row.source_type);
      return false;
    }
    return true;
  });

  const skippedCount = allProposalRows.length - validatedRows.length;
  if (skippedCount > 0) {
    console.warn(`[parser-validation] dropped ${skippedCount} invalid proposals`);
  }

  let insertedProposals: Array<{ id: string; proposal_type: string; normalized_payload: Record<string, unknown> }> = [];
  if (validatedRows.length > 0) {
    const { data: insertedRows, error: proposalErr } = await adminClient
      .from("proposals")
      .insert(validatedRows)
      .select("id, proposal_type, normalized_payload");
    if (proposalErr) {
      console.error("Failed to insert proposals:", proposalErr);
    } else if (insertedRows) {
      insertedProposals = insertedRows as typeof insertedProposals;
    }
  }

  // Memories — parser-extracted durable facts, written directly to the
  // memories table (no proposal-queue round trip). Dedupes case-insensitively.
  const memoriesCreated = await insertExtractedMemories(
    adminClient,
    userId,
    (parsed as { memories?: unknown }).memories
  );

  // Follow-ups — parser-extracted post-meeting relational touches. Written
  // directly to the follow_ups table (no proposal-queue round trip). The
  // /follow-ups page is the queue for these.
  const followUpsCreated = await insertExtractedFollowUps(
    adminClient,
    userId,
    meetingId,
    (parsed as { follow_ups?: unknown }).follow_ups
  );

  // Cluster detection: if this meeting produced 3+ task proposals, ask the
  // model whether any of them belong to a single named deliverable (e.g.
  // "the S&P deck"). Clusters land in proposal_groups as pending suggestions
  // -- never auto-applied. User accepts/rejects on the /proposals page.
  const groupsCreated = await detectProposalGroups({
    anthropicKey,
    adminClient,
    userId,
    meetingId,
    meetingTitle: meetingUpdate.title ?? currentTitle,
    meetingSummary: typeof parsed.synopsis === "string" ? parsed.synopsis : "",
    proposals: insertedProposals.filter((p) => p.proposal_type === "task"),
  });

  // Pursuit link suggestion: cheap deterministic pre-filter over active
  // pursuits, then (if any candidates pass) ask the model to pick at most
  // one. Result lands in pursuit_link_proposals as pending; never auto-applied.
  const pursuitLinksCreated = await suggestPursuitLink({
    anthropicKey,
    adminClient,
    userId,
    meetingId,
    meetingTitle: meetingUpdate.title ?? currentTitle,
    meetingSummary: typeof parsed.summary === "string" ? parsed.summary : "",
    attendees: (meeting.attendees as string[] | null) ?? [],
    discussionCompany,
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions as string[] : [],
  });

  return new Response(
    JSON.stringify({
      ...parsed,
      title: meetingUpdate.title ?? currentTitle,
      proposals_created: proposalRows.length,
      commitments_created: commitmentRows.length,
      memories_created: memoriesCreated,
      follow_ups_created: followUpsCreated,
      groups_created: groupsCreated,
      pursuit_links_created: pursuitLinksCreated,
      not_for_user: notForUser,
      skipped_speculative: skippedSpeculative,
      import_mode: "active",
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

// ----------------------------------------------------------------------------
// Proposal group detection
// ----------------------------------------------------------------------------
// Runs after task proposals are inserted. Asks Claude whether any 3+ of them
// share a single named deliverable discussed in this meeting. If yes, a
// proposal_groups row is inserted (always pending -- user must accept).
//
// Strict clustering criteria are in the prompt: 3+ members, concretely-named
// artifact, human-sayable parent title. The model is told to return an empty
// clusters array when in doubt.
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Memory insert — writes parser-extracted memories directly to the memories
// table with source='extracted_from_transcript'. Dedupes case-insensitively
// against existing memories as a safety belt (the parser is told not to
// re-emit, but we double-check).
// ----------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function insertExtractedMemories(adminClient: any, userId: string, raw: unknown): Promise<number> {
  if (!Array.isArray(raw)) return 0;
  const candidates: string[] = [];
  for (const m of raw) {
    if (m && typeof m === "object" && typeof (m as { content?: unknown }).content === "string") {
      const c = (m as { content: string }).content.trim();
      if (c && c.length <= 300) candidates.push(c);
    }
  }
  if (candidates.length === 0) return 0;

  // Load existing memories for this user so we can skip duplicates (case
  // insensitive exact-content match). Small table, cheap to scan.
  const { data: existing } = await adminClient
    .from("memories")
    .select("content")
    .eq("user_id", userId);
  const known = new Set(
    (existing ?? []).map((r: { content: string }) => r.content.trim().toLowerCase())
  );

  const toInsert: Array<{ user_id: string; content: string; source: string }> = [];
  const seenThisCall = new Set<string>();
  for (const c of candidates) {
    const key = c.toLowerCase();
    if (known.has(key) || seenThisCall.has(key)) continue;
    seenThisCall.add(key);
    toInsert.push({ user_id: userId, content: c, source: "extracted_from_transcript" });
  }

  if (toInsert.length === 0) return 0;

  const { error } = await adminClient.from("memories").insert(toInsert);
  if (error) {
    console.error("[ai-parse-transcript] memory insert error:", error);
    return 0;
  }
  return toInsert.length;
}

// ----------------------------------------------------------------------------
// Follow-up insert — writes parser-extracted follow-ups directly to the
// follow_ups table with status='pending'. The /follow-ups page is the
// review queue. Each follow-up carries a recipients[] jsonb where each
// recipient has its own draft body and sent_at — the user marks recipients
// individually via copy-to-clipboard. Most meetings produce 0 or 1
// follow-up; rarely more when audiences need materially different content.
// ----------------------------------------------------------------------------

interface FollowUpRecipientCandidate {
  name?: string;
  email?: string | null;
  rationale?: string;
}

interface FollowUpCandidate {
  rationale?: string;
  evidence_quote?: string | null;
  draft_subject?: string;
  draft_body?: string;
  recipients?: FollowUpRecipientCandidate[];
}

// deno-lint-ignore no-explicit-any
async function insertExtractedFollowUps(
  adminClient: any,
  userId: string,
  meetingId: string,
  raw: unknown,
): Promise<number> {
  if (!Array.isArray(raw)) return 0;

  const toInsert: Array<{
    user_id: string;
    source_meeting_id: string;
    status: string;
    rationale: string | null;
    evidence_text: string | null;
    draft_subject: string;
    draft_body: string;
    recipients: Array<{
      name: string;
      email: string | null;
      person_id: string | null;
      rationale: string | null;
    }>;
    ai_confidence: number;
  }> = [];

  for (const f of raw as FollowUpCandidate[]) {
    if (!f || typeof f !== "object") continue;

    const draftBody = typeof f.draft_body === "string" ? f.draft_body.trim() : "";
    if (!draftBody) continue; // No body, no follow-up

    const recipientsIn = Array.isArray(f.recipients) ? f.recipients : [];
    const recipients = recipientsIn
      .filter((r) =>
        r && typeof r === "object" &&
        typeof r.name === "string" && r.name.trim().length > 0
      )
      .map((r) => ({
        name: r.name!.trim(),
        email: typeof r.email === "string" && r.email.trim().length > 0 ? r.email.trim() : null,
        person_id: null as string | null,
        rationale: typeof r.rationale === "string" && r.rationale.trim().length > 0 ? r.rationale.trim() : null,
      }));

    if (recipients.length === 0) continue;

    toInsert.push({
      user_id: userId,
      source_meeting_id: meetingId,
      status: "pending",
      rationale: typeof f.rationale === "string" && f.rationale.trim().length > 0 ? f.rationale.trim() : null,
      evidence_text: typeof f.evidence_quote === "string" && f.evidence_quote.trim().length > 0
        ? f.evidence_quote.trim()
        : null,
      draft_subject: typeof f.draft_subject === "string" && f.draft_subject.trim().length > 0
        ? f.draft_subject.trim()
        : "Following up",
      draft_body: draftBody,
      recipients,
      ai_confidence: 0.7,
    });
  }

  if (toInsert.length === 0) return 0;

  const { error } = await adminClient.from("follow_ups").insert(toInsert);
  if (error) {
    console.error("[ai-parse-transcript] follow_up insert error:", error);
    return 0;
  }
  return toInsert.length;
}

interface ClusterDetectionArgs {
  anthropicKey: string;
  // deno-lint-ignore no-explicit-any
  adminClient: any;
  userId: string;
  meetingId: string;
  meetingTitle: string;
  meetingSummary: string;
  proposals: Array<{ id: string; proposal_type: string; normalized_payload: Record<string, unknown> }>;
}

async function detectProposalGroups(args: ClusterDetectionArgs): Promise<number> {
  const { anthropicKey, adminClient, userId, meetingId, meetingTitle, meetingSummary, proposals } = args;

  // No point calling the model if there aren't enough proposals for a cluster.
  if (proposals.length < 3) return 0;

  const proposalList = proposals.map((p, i) => {
    const payload = p.normalized_payload ?? {};
    const title = (payload.title as string | undefined) ?? "";
    const description = (payload.description as string | undefined) ?? "";
    return `[${i}] ${title}${description ? ` -- ${description.substring(0, 140)}` : ""}`;
  }).join("\n");

  const prompt = `You are reviewing the action items extracted from a single meeting. Your job is to decide whether any subset of them are really sub-steps toward ONE named deliverable.

MEETING: ${meetingTitle}
${meetingSummary ? `SUMMARY: ${meetingSummary.substring(0, 1200)}\n` : ""}

ACTION ITEMS:
${proposalList}

Return a JSON object with a "clusters" array. Each cluster represents 3+ action items that all contribute to a single concretely-named deliverable (a specific deck, document, proposal, demo, SOW, etc.).

STRICT CRITERIA -- only return a cluster if ALL of these are true:
1. At least 3 of the items listed above clearly feed into the same deliverable.
2. The deliverable has a concrete name a human would say out loud ("the S&P deck", "the FedEx SOW", "the proposal for Acme"). NOT vague themes like "sales follow-ups", "research items", "client outreach".
3. You can write a parent title like "Deck work for <client>" or "<specific deliverable> prep" that clearly names the artifact.
4. You are highly confident these items belong together. When in doubt, do NOT return a cluster.

It is perfectly acceptable to return an empty clusters array. Most meetings will not have a qualifying cluster. False positives are worse than missing a cluster.

Response schema:
{
  "clusters": [
    {
      "title": "Deck work for <named deliverable>",
      "item_indices": [0, 2, 5, 7],
      "confidence": 0.85
    }
  ]
}

Confidence must be between 0 and 1. Only return clusters with confidence >= 0.7. Return ONLY the JSON object, no prose.`;

  let clusterResponse: Response;
  try {
    clusterResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        temperature: 0.1,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    console.error("[cluster-detect] network error:", err);
    return 0;
  }

  if (!clusterResponse.ok) {
    console.error("[cluster-detect] Claude API error:", await clusterResponse.text());
    return 0;
  }

  const aiJson = await clusterResponse.json();
  const raw = (aiJson.content?.[0]?.text ?? "").trim();
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");

  let parsed: { clusters?: Array<{ title?: string; item_indices?: number[]; confidence?: number }> };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("[cluster-detect] failed to parse response:", err, "raw:", raw.substring(0, 300));
    return 0;
  }

  const clusters = Array.isArray(parsed.clusters) ? parsed.clusters : [];
  if (clusters.length === 0) return 0;

  const groupRows: Array<Record<string, unknown>> = [];
  for (const cluster of clusters) {
    const title = typeof cluster.title === "string" ? cluster.title.trim() : "";
    const indices = Array.isArray(cluster.item_indices) ? cluster.item_indices : [];
    const confidence = typeof cluster.confidence === "number" ? cluster.confidence : 0;

    if (!title || indices.length < 3 || confidence < 0.7) continue;

    const proposalIds = indices
      .map((i) => proposals[i]?.id)
      .filter((id): id is string => typeof id === "string");

    if (proposalIds.length < 3) continue;

    groupRows.push({
      user_id: userId,
      source_meeting_id: meetingId,
      suggested_title: title,
      proposal_ids: proposalIds,
      confidence,
      status: "pending",
    });
  }

  if (groupRows.length === 0) return 0;

  const { error } = await adminClient.from("proposal_groups").insert(groupRows);
  if (error) {
    console.error("[cluster-detect] failed to insert proposal_groups:", error);
    return 0;
  }

  return groupRows.length;
}

// Pursuit link suggestion is implemented in _shared/pursuit-matcher.ts
// (shared with backfill-pursuit-links).

// Normalize the parser's mentioned_companies output into the array we
// persist. Drops empties, trims, de-dupes case-insensitively, and excludes
// the discussion_company so the chips on the partner activity card don't
// double up. Caps at 30 — reasonable upper bound for a single meeting.
function cleanMentionedCompanies(
  raw: unknown,
  discussionCompany: string | null,
): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  if (discussionCompany) seen.add(discussionCompany.trim().toLowerCase());
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= 30) break;
  }
  return out;
}

// Prepend "Company: " to a title when a company is known and the title doesn't
// already start with the company name. Word-boundary aware so "Ivoclar" matches
// "Ivoclar deck" but not "Ivoclarian feedback".
function prefixWithCompany(title: string | null | undefined, company: string | null | undefined): string {
  const t = (title ?? "").trim();
  const c = (company ?? "").trim();
  if (!t || !c) return t;
  const lcT = t.toLowerCase();
  const lcC = c.toLowerCase();
  if (lcT.startsWith(lcC)) {
    const next = t.charAt(c.length);
    if (next === "" || /[^a-z0-9]/i.test(next)) return t;
  }
  return `${c}: ${t}`;
}
