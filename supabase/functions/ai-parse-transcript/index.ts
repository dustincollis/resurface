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

    const { meeting_id, transcript } = await req.json();
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
            content: `You are analyzing a meeting transcript. The transcript may be in any format: raw text, timestamped notes, VTT/SRT subtitles, or structured meeting notes. Handle all formats gracefully.

Extract:
1. Action items: tasks that need to be done, with assignee if detectable ("user" for the person uploading, name for others)
2. Decisions: things that were decided/agreed upon
3. Open questions: unresolved items that need follow-up
4. References to existing work items (match against provided list)

Current open items for cross-reference:
${itemsSummary}

Meeting title: "${meeting.title}"

Transcript:
${transcript.substring(0, 15000)}

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "summary": "2-3 sentence meeting summary",
  "action_items": [
    {"title": "...", "description": "...", "assignee": "user|name", "urgency": "high|medium|low", "related_item_ids": ["..."]}
  ],
  "decisions": [
    {"decision": "...", "context": "..."}
  ],
  "open_questions": [
    {"question": "...", "owner": "user|name|unknown"}
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

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      console.error("Failed to parse AI response:", rawContent);
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response" }),
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
