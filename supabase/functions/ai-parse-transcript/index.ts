import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

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

    const { meeting_id, transcript: bodyTranscript, user_context } = await req.json();
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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY")!;
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
    // Otherwise a meeting from April 2nd that says "I'll do it tomorrow"
    // would get a due date based on today, which can be a week or more off.
    // Falls back to today's date if start_time isn't set on the meeting.
    const meetingDate: Date =
      meeting.start_time ? new Date(meeting.start_time as string) : new Date();
    const meetingDateStr = isNaN(meetingDate.getTime())
      ? new Date().toISOString().split("T")[0]
      : meetingDate.toISOString().split("T")[0];
    const meetingDayOfWeek = isNaN(meetingDate.getTime())
      ? ""
      : new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(meetingDate);

    // Get user's existing items for cross-referencing
    const { data: items } = await adminClient
      .from("items")
      .select("id, title, stream_id, streams(name)")
      .eq("user_id", userId)
      .not("status", "in", '("done","dropped")')
      .limit(50);

    const itemsSummary = items
      ?.map(
        (i) =>
          `- [${i.id.substring(0, 8)}] "${i.title}" (stream: ${(i.streams as { name: string } | null)?.name ?? "none"})`
      )
      .join("\n") ?? "No existing items.";

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
        max_tokens: 4096,
        temperature: 0.3,
        messages: [
          {
            role: "user",
            content: `You are analyzing a discussion transcript or notes. The content may be in any format: raw text, timestamped notes, VTT/SRT subtitles, or structured meeting notes. Handle all formats gracefully.

**The user uploading this transcript is ${userDisplayName}.** When you see "${userDisplayName}" (or a clear first-name match) speaking or being addressed in the transcript, that IS the user.
${meeting.attendees && meeting.attendees.length > 0 ? `\n**Known meeting attendees**: ${meeting.attendees.join(", ")}\nUse this list as your reference for who was in the room. When the transcript has no speaker labels (or only generic "Speaker 1/2/3" labels), use this attendee list and contextual cues — names mentioned, people addressed directly, "as you said" references — to attribute statements to specific people where you can. If you cannot tell who said something, mark it as "unknown" rather than guessing.\n` : ""}
**Extraction philosophy**: Capture ALL real action items regardless of who they belong to. Do NOT drop items just because they're not assigned to ${userDisplayName} — better to surface a few items that turn out to be for someone else than to miss real commitments because attribution was unclear. The user will triage in the review queue.

${typeof user_context === "string" && user_context.length > 0 ? "\n" + user_context + "\n" : ""}
**This meeting took place on ${meetingDateStr}${meetingDayOfWeek ? ` (a ${meetingDayOfWeek})` : ""}.** When the transcript uses relative date language ("tomorrow", "next week", "by Friday", "end of month"), resolve it against the MEETING date — NOT against the date you're processing this transcript. "Tomorrow" in a meeting on April 2nd means April 3rd, regardless of when the parse runs.

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
     - **"user"** — if the action clearly belongs to ${userDisplayName} (e.g. ${userDisplayName} is the speaker stating their own commitment, or someone explicitly hands the task to ${userDisplayName})
     - **"<person's name>"** — if you can identify a specific other person who owns the action (use the attendee list when available)
     - **"unknown"** — when you can tell something was committed but you genuinely cannot determine who said it (common when transcripts have no speaker labels)
   - Whatever the assignee, INCLUDE THE ITEM. Do not drop items because attribution is uncertain. The user will triage manually.
   - **evidence_quote**: A short verbatim quote from the transcript (under 200 chars) that directly supports this being a real commitment. This is the actual sentence where the commitment was made. If you cannot point to a quote, the item is not real and you should drop it.
   - Assign urgency (high/medium/low)
   - **Suggest a due date** (YYYY-MM-DD format) ONLY if the transcript mentions a specific deadline, timeframe ("by end of week", "next month"), or implies urgency. **Use the meeting date (${meetingDateStr}) as the reference for resolving any relative date language**, NOT today's date. If no due date is implied, use null.
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
   - **do_by**: YYYY-MM-DD if a date is mentioned or strongly implied. **This is the primary date.** Resolve any relative dates ("next week", "by Friday", "tomorrow") against the MEETING date (${meetingDateStr}), NOT today. If only a vague timing is given ("soon", "this week"), still try — be best-effort. null only if there's truly no temporal signal at all.
   - **promised_by**: usually the same as do_by; only set differently if the user said "I told them by X but I need it ready by Y"
   - **needs_review_by**: only if explicitly mentioned ("I need someone to review it before X")
   - **evidence_quote**: verbatim from the transcript, the line where the user made the commitment
   - **ambiguity_flags**: array, any of: "social_language", "relative_date", "external_dependency", "ambiguous_actionability", "no_counterpart"

6. **References**: Match against existing work items where applicable

7. **Discussion Company**: At the top level, if the entire discussion is about one company/account, identify it. Same rules as above — only use a name that's clearly present.

8. **Suggested Title**: A short, descriptive title for this discussion, suitable as a meeting name. Aim for 4–10 words. Use the cleanest, most identifying form. Examples: "Adobe AEM cloud migration kickoff", "S&P pricing review with Holly", "Q3 planning standup". Avoid generic titles like "Meeting" or "Discussion". Capture the company and the topic when both are clear.

Current open items for cross-reference:
${itemsSummary}

Discussion title: "${meeting.title}"

Content:
${transcript}

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
}`,
          },
        ],
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

    // Auto-rename the meeting if its current title is a placeholder. We
    // consider any of these placeholders: empty/whitespace, starts with
    // "Untitled", or matches a filename-ish pattern (looks like the file
    // upload didn't get a real name).
    const currentTitle = (meeting.title ?? "").trim();
    const isPlaceholderTitle =
      currentTitle.length === 0 ||
      /^untitled/i.test(currentTitle) ||
      /\.(txt|md|vtt|srt|hda|json)$/i.test(currentTitle) ||
      /^\d{8}[-_]\d{6}/.test(currentTitle); // HDA-style filenames
    const aiTitle =
      typeof parsed.title === "string" && parsed.title.trim().length > 0
        ? parsed.title.trim()
        : null;

    // Update the meeting with parsed data.
    // Action items now flow to the proposals table instead of being stored
    // here as jsonb — `extracted_action_items` is no longer written.
    // Only overwrite the transcript field if the body carried one (i.e. this
    // is a fresh upload, not a re-trigger reading from the existing record).
    const meetingUpdate: Record<string, unknown> = {
      ...(typeof bodyTranscript === "string" && bodyTranscript.length >= 100
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
      .eq("id", meeting_id);

    // Mode-aware proposal creation: archive meetings get all the summary
    // metadata above but never produce live commitments. Skip the rest.
    const importMode = (meeting.import_mode as string | undefined) ?? "active";
    if (importMode === "archive") {
      // Make sure no stale pending proposals from a prior active-mode parse
      // are left behind on this meeting.
      await adminClient
        .from("proposals")
        .delete()
        .eq("user_id", userId)
        .eq("source_type", "meeting")
        .eq("source_id", meeting_id)
        .eq("status", "pending");

      return new Response(
        JSON.stringify({
          ...parsed,
          title: meetingUpdate.title ?? currentTitle,
          proposals_created: 0,
          not_for_user: 0,
          skipped_speculative: 0,
          import_mode: "archive",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Re-parse safety: clear any pending proposals from this meeting before
    // regenerating. Reviewed proposals (accepted/rejected/merged/dismissed)
    // are preserved because they represent the user's labeled judgments.
    await adminClient
      .from("proposals")
      .delete()
      .eq("user_id", userId)
      .eq("source_type", "meeting")
      .eq("source_id", meeting_id)
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

    // Fall back to discussion-level company when the AI didn't tag a
    // per-item company. The prompt asks for both, but the model often
    // omits the per-item field when the whole call is about one account.
    const discussionCompany: string | null =
      typeof parsed.company === "string" && parsed.company.trim().length > 0
        ? parsed.company.trim()
        : null;

    // We used to filter action items by user assignee, but that dropped real
    // items whenever attribution was unclear (which is common when transcripts
    // lack speaker labels). New approach: include all real action items
    // regardless of who they belong to. The user triages in the review queue.
    // Speculative items are still dropped — those are topics, not actions.

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
    // Track how many items couldn't be attributed to the user, for the
    // success banner — but include them all in the proposals queue.
    const notForUser = allActionItems.filter((a) => !isUserAssignee(a.assignee)).length;

    const proposalRows: ProposalInsert[] = allActionItems.map((a) => {
      const flags: string[] = [];
      if (!a.suggested_due_date) {
        flags.push("no_due_date");
      }
      if (a.commitment_strength === "implied") {
        flags.push("implied_commitment");
      }

      // Confidence reflects the model's commitment-strength signal.
      // Explicit commitments start higher; implied ones lower.
      // Chunk 2 will refine this further with reconciliation match strength.
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
        source_id: meeting_id,
        evidence_text: evidenceQuote,
        normalized_payload: {
          title: a.title,
          description: a.description ?? "",
          due_date: a.suggested_due_date ?? null,
          company,
          assignee: a.assignee ?? null,
          urgency: a.urgency ?? null,
          commitment_strength: a.commitment_strength ?? null,
          source_meeting_id: meeting_id,
        },
        confidence: baseConfidence,
        ambiguity_flags: flags,
      };
    });

    // ============================================================
    // Commitment proposals (chunk 3)
    // ============================================================
    // The model already filters to outgoing-only (the prompt insists). We
    // just shape the rows and add ambiguity flags.
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
          source_id: meeting_id,
          evidence_text: evidenceQuote,
          normalized_payload: {
            title: c.title,
            description: c.description ?? "",
            counterpart: c.counterpart ?? null,
            company,
            do_by: c.do_by ?? null,
            promised_by: c.promised_by ?? null,
            needs_review_by: c.needs_review_by ?? null,
            source_meeting_id: meeting_id,
          },
          confidence: 0.6,
          ambiguity_flags: flags,
        };
      });

    const allProposalRows = [...proposalRows, ...commitmentRows];

    // C5: Validate proposal shape before writing — catch prompt drift
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
