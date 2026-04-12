import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import {
  resolvePerson,
  resolveCompany,
  resolveAttendees,
} from "../_shared/resolve-identity.ts";

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
    const serviceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
    const isServiceRole =
      (serviceRoleKey && token === serviceRoleKey) ||
      (serviceRoleKey && apiKeyHeader === serviceRoleKey);

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
        .not("status", "in", '("done","dropped")')
        .limit(50);

      itemsSummary = items
        ?.map(
          (i) =>
            `- [${i.id.substring(0, 8)}] "${i.title}" (stream: ${(i.streams as { name: string } | null)?.name ?? "none"})`
        )
        .join("\n") ?? "No existing items.";
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

    // Build the prompt based on mode
    const prompt = parseMode === "historical"
      ? buildHistoricalPrompt({
          userDisplayName,
          attendees: meeting.attendees as string[] | null,
          userContext: typeof user_context === "string" ? user_context : "",
          meetingDateStr,
          meetingDayOfWeek,
          meetingTitle: meeting.title as string,
          transcript,
          topicVocabulary,
        })
      : buildActivePrompt({
          userDisplayName,
          attendees: meeting.attendees as string[] | null,
          userContext: typeof user_context === "string" ? user_context : "",
          meetingDateStr,
          meetingDayOfWeek,
          meetingTitle: meeting.title as string,
          transcript,
          itemsSummary,
        });

    // Call Claude to parse the transcript
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: parseMode === "historical" ? 8192 : 4096,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
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
        currentTitle, isPlaceholderTitle, aiTitle, bodyTranscript
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

function buildHistoricalPrompt(opts: PromptOpts & { topicVocabulary: string }): string {
  const attendeeBlock = opts.attendees && opts.attendees.length > 0
    ? `\n**Known meeting attendees**: ${opts.attendees.join(", ")}\nUse this list as your reference for who was in the room. When the transcript has no speaker labels (or only generic "Speaker 1/2/3" labels), use this attendee list and contextual cues to attribute statements to specific people where you can.\n`
    : "";

  const topicHint = opts.topicVocabulary
    ? `\nPreviously seen topics (prefer reusing these labels where the same subject recurs): ${opts.topicVocabulary}\n`
    : "";

  return `You are analyzing a historical meeting transcript. This meeting has already occurred and its outcomes have already played out. Your job is to extract structured information for archival and pattern analysis purposes, not to create actionable tasks.

**The user is ${opts.userDisplayName}.** When you see "${opts.userDisplayName}" (or a clear first-name match) speaking or being addressed in the transcript, that IS the user. He works at EPAM in a senior sales/GTM leadership role focused on partner alliances.
${attendeeBlock}
${opts.userContext ? opts.userContext + "\n" : ""}
**This meeting took place on ${opts.meetingDateStr}${opts.meetingDayOfWeek ? ` (a ${opts.meetingDayOfWeek})` : ""}.** When the transcript uses relative date language, resolve against the MEETING date, NOT today's date.

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

5. **COMMITMENTS**: Promises or obligations — both outgoing (${opts.userDisplayName} promised something) and incoming (someone promised something to ${opts.userDisplayName} or his team). For each:
   - title: short summary (5-12 words)
   - description: longer context if helpful
   - direction: "outgoing" if ${opts.userDisplayName} committed, "incoming" if committed TO ${opts.userDisplayName}
   - counterpart: the other party (free text)
   - company: account/client this is about
   - do_by: YYYY-MM-DD if mentioned (resolve relative dates against meeting date)
   - evidence_quote: verbatim or close paraphrase from transcript (under 200 chars)
   Only extract explicit commitments — someone clearly saying they will do something. Do not infer from general discussion.

6. **KEY TOPICS**: 3-8 short topic labels that characterize what this meeting was about. Examples: "Adobe partnership pricing", "S&P AEM migration timeline", "team hiring Q1". Keep labels concise and reusable across meetings about the same subject.${topicHint}

7. **IDEAS — STRICT CRITERIA**: Strategic ideas worth archiving for ${opts.userDisplayName}'s future reference. BE HIGHLY SELECTIVE. Most meetings produce 0-3 real strategic ideas, not 10-20. Err aggressively on the side of extracting fewer.

   ${opts.userDisplayName}'s role context: Head of Content Go-to-Market at EPAM. Runs partner alliances (Adobe, Sitecore, ContentStack, Contentful, Microsoft) for content management, DAM, and search. E-commerce is NOT his scope — a counterpart owns commerce.

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

Discussion title: "${opts.meetingTitle}"

Content:
${opts.transcript}

Respond with ONLY valid JSON (no markdown wrapping, no code fences). Schema:
{
  "summary": "string (markdown synopsis)",
  "title": "string",
  "company": "string or null",
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
  ]
}`;
}

function buildActivePrompt(opts: PromptOpts & { itemsSummary: string }): string {
  const attendeeBlock = opts.attendees && opts.attendees.length > 0
    ? `\n**Known meeting attendees**: ${opts.attendees.join(", ")}\nUse this list as your reference for who was in the room. When the transcript has no speaker labels (or only generic "Speaker 1/2/3" labels), use this attendee list and contextual cues — names mentioned, people addressed directly, "as you said" references — to attribute statements to specific people where you can. If you cannot tell who said something, mark it as "unknown" rather than guessing.\n`
    : "";

  return `You are analyzing a discussion transcript or notes. The content may be in any format: raw text, timestamped notes, VTT/SRT subtitles, or structured meeting notes. Handle all formats gracefully.

**The user uploading this transcript is ${opts.userDisplayName}.** When you see "${opts.userDisplayName}" (or a clear first-name match) speaking or being addressed in the transcript, that IS the user.
${attendeeBlock}
**Extraction philosophy**: Capture ALL real action items regardless of who they belong to. Do NOT drop items just because they're not assigned to ${opts.userDisplayName} — better to surface a few items that turn out to be for someone else than to miss real commitments because attribution was unclear. The user will triage in the review queue.

${opts.userContext ? "\n" + opts.userContext + "\n" : ""}
**This meeting took place on ${opts.meetingDateStr}${opts.meetingDayOfWeek ? ` (a ${opts.meetingDayOfWeek})` : ""}.** When the transcript uses relative date language ("tomorrow", "next week", "by Friday", "end of month"), resolve it against the MEETING date — NOT against the date you're processing this transcript. "Tomorrow" in a meeting on April 2nd means April 3rd, regardless of when the parse runs.

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

   Examples:
   - ✓ COUNT — "I'll have the deck to you by Friday" → explicit commitment by speaker
   - ✓ COUNT — "Holly: Can you review the contract?" "Yeah, I'll get to it tomorrow" → explicit accepted assignment to whoever said yes
   - ✓ COUNT — "Tom is going to update the spreadsheet by Wednesday" → explicit commitment by Tom
   - ✗ SKIP — "We should probably revisit pricing at some point" → speculative, no commitment
   - ✗ SKIP — "It would be great if marketing could help with this" → aspirational, no commitment
   - ✗ SKIP — "We talked about needing better dashboards" → discussion topic, no actor or commitment
   - ✗ SKIP — "What about doing a roadshow next quarter?" → hypothetical question

   For each real action item, return:
   - **commitment_strength**: "explicit" (direct verbal commitment with clear actor and verb) | "implied" (strong implication but not stated directly, e.g. someone restates a plan they're owning). Do NOT return items weaker than "implied" — those are not action items, they are topics.
   - **assignee**: Best-effort attribution. Use one of:
     - **"user"** — if the action clearly belongs to ${opts.userDisplayName} (e.g. ${opts.userDisplayName} is the speaker stating their own commitment, or someone explicitly hands the task to ${opts.userDisplayName})
     - **"<person's name>"** — if you can identify a specific other person who owns the action (use the attendee list when available)
     - **"unknown"** — when you can tell something was committed but you genuinely cannot determine who said it (common when transcripts have no speaker labels)
   - Whatever the assignee, INCLUDE THE ITEM. Do not drop items because attribution is uncertain. The user will triage manually.
   - **evidence_quote**: A short verbatim quote from the transcript (under 200 chars) that directly supports this being a real commitment. This is the actual sentence where the commitment was made. If you cannot point to a quote, the item is not real and you should drop it.
   - Assign urgency (high/medium/low)
   - **Suggest a due date** (YYYY-MM-DD format) ONLY if the transcript mentions a specific deadline, timeframe ("by end of week", "next month"), or implies urgency. **Use the meeting date (${opts.meetingDateStr}) as the reference for resolving any relative date language**, NOT today's date. If no due date is implied, use null.
   - **Identify the company / account / client** this task is about, if applicable. Look at the discussion title (e.g. "S&P pricing call", "Adobe HCLS - Follow up", "Acme Corp standup") and the content for an org name. Use the cleanest short form (e.g. "Adobe", "S&P", "Acme Corp"). If the task is internal-only or no company is mentioned, use null. Do NOT invent company names. **If the discussion is clearly about a single company, set the company field on EVERY action item to that company name** — don't leave action items blank just because the company isn't repeated in that specific bullet.

3. **Decisions**: Things that were decided/agreed upon

4. **Open Questions**: Unresolved items that need follow-up

5. **Commitments — OUTGOING SOFT OBLIGATIONS**: Things ${opts.userDisplayName} acknowledged owing or agreed to do, where the obligation is **relational or social** rather than a clean deliverable. These often slip because they're not formal tasks at the moment they happen.

   Extract a commitment ONLY if ALL of these are true:
   - ${opts.userDisplayName} is the one making the commitment (it goes FROM the user TO someone else — outgoing only, never incoming)
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
   - **counterpart**: the person ${opts.userDisplayName} made the promise TO (free text — e.g. "Holly", "the procurement team"). null if unclear.
   - **company**: the account/client this is about, same rules as action items
   - **do_by**: YYYY-MM-DD if a date is mentioned or strongly implied. **This is the primary date.** Resolve any relative dates ("next week", "by Friday", "tomorrow") against the MEETING date (${opts.meetingDateStr}), NOT today. If only a vague timing is given ("soon", "this week"), still try — be best-effort. null only if there's truly no temporal signal at all.
   - **promised_by**: usually the same as do_by; only set differently if the user said "I told them by X but I need it ready by Y"
   - **needs_review_by**: only if explicitly mentioned ("I need someone to review it before X")
   - **evidence_quote**: verbatim from the transcript, the line where the user made the commitment
   - **ambiguity_flags**: array, any of: "social_language", "relative_date", "external_dependency", "ambiguous_actionability", "no_counterpart"

6. **References**: Match against existing work items where applicable

7. **Discussion Company**: At the top level, if the entire discussion is about one company/account, identify it. Same rules as above — only use a name that's clearly present.

8. **Suggested Title**: A short, descriptive title for this discussion, suitable as a meeting name. Aim for 4–10 words. Use the cleanest, most identifying form. Examples: "Adobe AEM cloud migration kickoff", "S&P pricing review with Holly", "Q3 planning standup". Avoid generic titles like "Meeting" or "Discussion". Capture the company and the topic when both are clear.

Current open items for cross-reference:
${opts.itemsSummary}

Discussion title: "${opts.meetingTitle}"

Content:
${opts.transcript}

Respond with ONLY valid JSON (no markdown wrapping, no code fences). Schema:
{
  "summary": "<the markdown synopsis as a single string>",
  "title": "string (4-10 words, descriptive)",
  "company": "string or null",
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
  ]
}`;
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
          companyId = await resolveCompany(adminClient, userId, companyName);
        } catch { /* non-fatal */ }
      }

      const personId = await resolvePerson(adminClient, userId, {
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
        title: c.title.trim(),
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
        companyId = await resolveCompany(adminClient, userId, companyName);
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

  return new Response(
    JSON.stringify({
      ...parsed,
      title: meetingUpdate.title ?? currentTitle,
      mode: "historical",
      proposals_created: 0,
      commitments_created: commitmentsCreated,
      ideas_created: ideasCreated,
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

  const actionItems = (parsed.action_items ?? []) as Array<{
    title?: string;
    description?: string;
    commitment_strength?: "explicit" | "implied" | "speculative";
    evidence_quote?: string | null;
    company?: string | null;
    assignee?: string;
    urgency?: string;
    suggested_due_date?: string | null;
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
  };

  function normalizeName(s: string): string {
    return s
      .toLowerCase()
      .replace(/[._\-]+/g, " ")
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

    return {
      user_id: userId,
      proposal_type: "task",
      source_type: "meeting",
      source_id: meetingId,
      evidence_text: evidenceQuote,
      normalized_payload: {
        title: a.title,
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
          title: c.title,
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

  if (validatedRows.length > 0) {
    const { error: proposalErr } = await adminClient
      .from("proposals")
      .insert(validatedRows);
    if (proposalErr) {
      console.error("Failed to insert proposals:", proposalErr);
    }
  }

  return new Response(
    JSON.stringify({
      ...parsed,
      title: meetingUpdate.title ?? currentTitle,
      proposals_created: proposalRows.length,
      commitments_created: commitmentRows.length,
      not_for_user: notForUser,
      skipped_speculative: skippedSpeculative,
      import_mode: "active",
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}
