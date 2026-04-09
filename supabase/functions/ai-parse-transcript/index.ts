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

    const { meeting_id, transcript, user_context } = await req.json();
    if (!meeting_id || !transcript) {
      return new Response(
        JSON.stringify({ error: "meeting_id and transcript required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify user from JWT
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
    } = await adminClient.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify meeting ownership
    const { data: meeting, error: meetingError } = await adminClient
      .from("meetings")
      .select("*")
      .eq("id", meeting_id)
      .eq("user_id", user.id)
      .single();

    if (meetingError || !meeting) {
      return new Response(JSON.stringify({ error: "Meeting not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch user's display name so we can teach the AI who "the user" is
    // by name, and so we can later filter action items by assignee.
    const { data: profile } = await adminClient
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .single();
    const userDisplayName: string =
      (profile?.display_name as string | undefined)?.trim() ||
      user.email?.split("@")[0] ||
      "the user";

    // Get user's existing items for cross-referencing
    const { data: items } = await adminClient
      .from("items")
      .select("id, title, stream_id, streams(name)")
      .eq("user_id", user.id)
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

**The user uploading this transcript is ${userDisplayName}.** When you see "${userDisplayName}" (or a clear first-name match) speaking in the transcript, that IS the user. Treat their statements as first-person.

**CRITICAL — User presence check:** Before extracting any "user" action items, verify that ${userDisplayName} actually appears as a speaker or named participant in the transcript. If ${userDisplayName} is NOT a speaker and is NOT mentioned by name anywhere in the content, you MUST mark every action item with the actual speaker's name (e.g. "Brandon", "Sarkis"). Do NOT fall back to assignee="user" just because the upload happened — the user being absent from the conversation means none of the action items are theirs. The system will filter accordingly. It is correct and expected to return zero "user" action items in this case.

${meeting.attendees && meeting.attendees.length > 0 ? `Known meeting attendees (from calendar metadata): ${meeting.attendees.join(", ")}\n` : ""}
${typeof user_context === "string" && user_context.length > 0 ? "\n" + user_context + "\n" : `\nToday's date: ${new Date().toISOString().split('T')[0]}\n`}
Extract these elements:

1. Synopsis: A structured summary with these exact section headers (use "## " prefix for headers, plain prose otherwise — do NOT use **bold** or *italic* markers in the body text):
   - "## Overview" — one paragraph: who participated, what was discussed, primary outcome
   - "## Key Topics Discussed" — use "- " bullet points for main topics with 1-2 sentences of context each
   - "## Participants & Perspectives" — who said what, key positions and concerns (use "- " bullets per participant)
   - "## Outcomes & Next Steps" — what was resolved, what remains open, what happens next

2. **Action Items — STRICT CRITERIA**: Only extract items that are real commitments to act, not topics that were merely discussed. Be conservative. It is much better to return zero action items than to return a speculative or aspirational one.

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
   - ✓ COUNT — "I'll have the deck to you by Friday" → explicit user commitment, due Friday
   - ✓ COUNT — "Holly: Can you review the contract?" "${userDisplayName}: Yeah, I'll get to it tomorrow" → explicit accepted assignment
   - ✗ SKIP — "We should probably revisit pricing at some point" → speculative, no commitment
   - ✗ SKIP — "It would be great if marketing could help with this" → aspirational, no commitment
   - ✗ SKIP — "We talked about needing better dashboards" → discussion topic, no actor or commitment
   - ✗ SKIP — "What about doing a roadshow next quarter?" → hypothetical question

   For each real action item, return:
   - **commitment_strength**: "explicit" (direct verbal commitment with clear actor and verb) | "implied" (strong implication but not stated directly, e.g. someone restates a plan they're owning). Do NOT return items weaker than "implied" — those are not action items, they are topics.
   - **assignee**: This is the most important field. Use exactly one of these values:
     - **"user"** — if the action belongs to ${userDisplayName}. This includes: things ${userDisplayName} explicitly said they'd do ("I'll send the deck"), things others assigned to ${userDisplayName} that ${userDisplayName} accepted, and tasks where ${userDisplayName} is the clear owner. When in doubt and ${userDisplayName} is the speaker stating their own commitment, use "user".
     - **"<person's name>"** — if the action belongs to someone other than ${userDisplayName}. Use the actual name (e.g. "Holly", "Sarah Chen"). Things others said they'd do, even if relevant to ${userDisplayName}, go here. Do NOT use "user" for these.
     - **"unknown"** — only if the assignee is genuinely unclear from the transcript.
   - **evidence_quote**: A short verbatim quote from the transcript (under 200 chars) that directly supports this being a real commitment. This is the actual sentence where the commitment was made. If you cannot point to a quote, the item is not real and you should drop it.
   - Assign urgency (high/medium/low)
   - **Suggest a due date** (YYYY-MM-DD format) ONLY if the transcript mentions a specific deadline, timeframe ("by end of week", "next month"), or implies urgency. Use today's date as the reference. If no due date is implied, use null.
   - **Identify the company / account / client** this task is about, if applicable. Look at the discussion title (e.g. "S&P pricing call", "Adobe HCLS - Follow up", "Acme Corp standup") and the content for an org name. Use the cleanest short form (e.g. "Adobe", "S&P", "Acme Corp"). If the task is internal-only or no company is mentioned, use null. Do NOT invent company names. **If the discussion is clearly about a single company, set the company field on EVERY action item to that company name** — don't leave action items blank just because the company isn't repeated in that specific bullet.

3. **Decisions**: Things that were decided/agreed upon

4. **Open Questions**: Unresolved items that need follow-up

5. **References**: Match against existing work items where applicable

6. **Discussion Company**: At the top level, if the entire discussion is about one company/account, identify it. Same rules as above — only use a name that's clearly present.

Current open items for cross-reference:
${itemsSummary}

Discussion title: "${meeting.title}"

Content:
${transcript.substring(0, 15000)}

Respond with ONLY valid JSON (no markdown wrapping, no code fences). Schema:
{
  "summary": "<the markdown synopsis as a single string>",
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

    // Update the meeting with parsed data.
    // Action items now flow to the proposals table instead of being stored
    // here as jsonb — `extracted_action_items` is no longer written.
    await adminClient
      .from("meetings")
      .update({
        transcript,
        transcript_summary: parsed.summary,
        extracted_action_items: [],
        extracted_decisions: parsed.decisions ?? [],
        extracted_open_questions: parsed.open_questions ?? [],
        processed_at: new Date().toISOString(),
      })
      .eq("id", meeting_id);

    // Re-parse safety: clear any pending proposals from this meeting before
    // regenerating. Reviewed proposals (accepted/rejected/merged/dismissed)
    // are preserved because they represent the user's labeled judgments.
    await adminClient
      .from("proposals")
      .delete()
      .eq("user_id", user.id)
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

    // Decide which extracted action items belong to the user. STRICT match —
    // we only accept items where the AI explicitly identified the user.
    // null/missing/"unknown" are NOT included: those are signs the AI couldn't
    // place the action with confidence, and historically these were the source
    // of false positives where users got tagged with random meeting items.
    //
    // We normalize the display name to handle email-derived fallbacks
    // ("dustin.collis", "dustincollis") and compare against the assignee's
    // tokens too (so "Dustin C." and "Dustin Collis" both match).
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
      // "unknown" is dropped — too noisy in practice
      if (raw === "unknown") return false;
      const norm = normalizeName(assignee);
      if (norm === userNameNorm) return true;
      // First-name match only when first name is distinctive (>=3 chars)
      if (userFirstToken.length >= 3 && norm === userFirstToken) return true;
      // Multi-token match: assignee tokens are a subset of user tokens
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
    // Drop anything the model still labeled speculative even after the
    // strict prompt — belt and suspenders.
    const realCommitments = titledActionItems.filter(
      (a) => a.commitment_strength !== "speculative"
    );
    const skippedSpeculative = titledActionItems.length - realCommitments.length;
    const userActionItems = realCommitments.filter((a) => isUserAssignee(a.assignee));
    const skippedForOthers = realCommitments.length - userActionItems.length;

    const proposalRows: ProposalInsert[] = userActionItems.map((a) => {
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
        user_id: user.id,
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

    if (proposalRows.length > 0) {
      const { error: proposalErr } = await adminClient
        .from("proposals")
        .insert(proposalRows);
      if (proposalErr) {
        console.error("Failed to insert proposals:", proposalErr);
        // Don't fail the whole call — the parse result is still saved.
      }
    }

    return new Response(
      JSON.stringify({
        ...parsed,
        proposals_created: proposalRows.length,
        skipped_for_others: skippedForOthers,
        skipped_speculative: skippedSpeculative,
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
