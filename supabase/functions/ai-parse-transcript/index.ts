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
${typeof user_context === "string" && user_context.length > 0 ? "\n" + user_context + "\n" : `\nToday's date: ${new Date().toISOString().split('T')[0]}\n`}
Extract these elements:

1. Synopsis: A structured summary with these exact section headers (use "## " prefix for headers, plain prose otherwise — do NOT use **bold** or *italic* markers in the body text):
   - "## Overview" — one paragraph: who participated, what was discussed, primary outcome
   - "## Key Topics Discussed" — use "- " bullet points for main topics with 1-2 sentences of context each
   - "## Participants & Perspectives" — who said what, key positions and concerns (use "- " bullets per participant)
   - "## Outcomes & Next Steps" — what was resolved, what remains open, what happens next

2. **Action Items**: Tasks that need to be done. For each:
   - Detect the assignee ("user" for the person uploading, name for others)
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
      "company": "string or null",
      "assignee": "user|name",
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
        JSON.stringify({ error: "AI transcript parsing failed" }),
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

    // Update the meeting with parsed data
    await adminClient
      .from("meetings")
      .update({
        transcript,
        transcript_summary: parsed.summary,
        extracted_action_items: parsed.action_items ?? [],
        extracted_decisions: parsed.decisions ?? [],
        extracted_open_questions: parsed.open_questions ?? [],
        processed_at: new Date().toISOString(),
      })
      .eq("id", meeting_id);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
