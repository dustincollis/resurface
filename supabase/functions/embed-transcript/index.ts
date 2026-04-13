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

    const { meeting_id } = await req.json();
    if (!meeting_id) {
      return new Response(
        JSON.stringify({ error: "meeting_id required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const voyageKey = Deno.env.get("VOYAGE_API_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Auth: service role (Python batch) or user JWT (browser)
    const apiKeyHeader =
      req.headers.get("apikey") ?? req.headers.get("ApiKey") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isServiceRole =
      (serviceRoleKey && token === serviceRoleKey) ||
      (serviceRoleKey && apiKeyHeader === serviceRoleKey);

    // Load meeting
    const { data: meeting, error: meetingError } = await adminClient
      .from("meetings")
      .select("id, user_id, transcript, title")
      .eq("id", meeting_id)
      .single();

    if (meetingError || !meeting) {
      return new Response(JSON.stringify({ error: "Meeting not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let userId: string;
    if (isServiceRole) {
      userId = meeting.user_id;
    } else {
      const {
        data: { user },
      } = await adminClient.auth.getUser(token);
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (meeting.user_id !== user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    const transcript = (meeting.transcript as string) ?? "";
    if (transcript.length < 100) {
      return new Response(
        JSON.stringify({
          ok: true,
          skipped: true,
          reason: "no_transcript",
          chunks_created: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Delete old chunks if re-embedding
    await adminClient
      .from("meeting_chunks")
      .delete()
      .eq("meeting_id", meeting_id);

    // ----------------------------------------------------------------
    // Step 1: Call Haiku to identify topic boundaries
    // ----------------------------------------------------------------
    const lines = transcript.split("\n");

    // For very short transcripts, skip Haiku and use the whole thing as one chunk
    let chunkDefs: Array<{
      topic_label: string;
      lines: [number, number];
      speakers: string[];
    }>;

    if (lines.length <= 15) {
      // Single chunk for short transcripts
      const speakers = extractSpeakers(lines);
      chunkDefs = [
        {
          topic_label: (meeting.title as string) || "Full conversation",
          lines: [0, lines.length - 1],
          speakers,
        },
      ];
    } else {
      // Number lines for the prompt
      const numberedTranscript = lines
        .map((line, i) => `${i}: ${line}`)
        .join("\n");

      const chunkResponse = await fetch(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 4096,
            temperature: 0.2,
            messages: [
              {
                role: "user",
                content: `You are a transcript segmentation specialist. Given a timestamped meeting transcript with line numbers, identify distinct topic segments and return their boundaries.

Rules:
- Each chunk should cover ONE coherent topic or discussion thread
- Target chunk size: 15-60 transcript lines (roughly 200-800 words)
- Minimum chunk size: 3 lines (do not create tiny fragments)
- Maximum chunk size: ~80 lines (split very long single-topic discussions at natural speaker transitions)
- Every line must be covered — no gaps between chunks
- Chunks must not overlap
- Identify which speakers appear in each chunk (use the speaker labels from the transcript)

Return ONLY valid JSON (no markdown, no code fences):
{
  "chunks": [
    {
      "topic_label": "Short descriptive label (3-8 words)",
      "lines": [first_line_index, last_line_index],
      "speakers": ["Speaker 1", "Holly"]
    }
  ]
}

The "lines" field uses 0-based inclusive indices matching the line numbers below.

Transcript:
${numberedTranscript}`,
              },
            ],
          }),
        }
      );

      if (!chunkResponse.ok) {
        const errText = await chunkResponse.text();
        console.error("Haiku chunking error:", errText);
        return new Response(
          JSON.stringify({
            error: "Chunking failed",
            detail: errText.substring(0, 500),
            status: chunkResponse.status,
          }),
          {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const aiResponse = await chunkResponse.json();
      let rawContent = (aiResponse.content?.[0]?.text ?? "").trim();
      if (rawContent.startsWith("```")) {
        rawContent = rawContent
          .replace(/^```(?:json)?\s*\n?/, "")
          .replace(/\n?```\s*$/, "");
      }

      let parsed: { chunks: Array<{ topic_label: string; lines: [number, number]; speakers: string[] }> };
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        console.error("Failed to parse Haiku response:", rawContent.substring(0, 500));
        return new Response(
          JSON.stringify({
            error: "Failed to parse chunking response",
            raw: rawContent.substring(0, 500),
          }),
          {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      chunkDefs = (parsed.chunks ?? []).filter(
        (c) =>
          Array.isArray(c.lines) &&
          c.lines.length === 2 &&
          typeof c.lines[0] === "number" &&
          typeof c.lines[1] === "number" &&
          c.lines[1] >= c.lines[0] &&
          c.lines[0] >= 0 &&
          c.lines[1] < lines.length
      );

      if (chunkDefs.length === 0) {
        // Fallback: treat whole transcript as one chunk
        const speakers = extractSpeakers(lines);
        chunkDefs = [
          {
            topic_label: (meeting.title as string) || "Full conversation",
            lines: [0, lines.length - 1],
            speakers,
          },
        ];
      }
    }

    // Build chunk texts from line indices
    const chunks = chunkDefs.map((c, i) => {
      const chunkLines = lines.slice(c.lines[0], c.lines[1] + 1);
      const text = chunkLines.join("\n");
      return {
        chunk_index: i,
        topic_label: c.topic_label,
        chunk_text: text,
        speakers: c.speakers ?? extractSpeakers(chunkLines),
        start_time_offset: extractTimestamp(chunkLines[0]),
        end_time_offset: extractTimestamp(chunkLines[chunkLines.length - 1]),
        token_count: Math.ceil(text.length / 4),
      };
    });

    // ----------------------------------------------------------------
    // Step 2: Call Voyage to embed all chunks
    // ----------------------------------------------------------------
    const textsToEmbed = chunks.map((c) => c.chunk_text);

    const voyageResp = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${voyageKey}`,
      },
      body: JSON.stringify({
        input: textsToEmbed,
        model: "voyage-3-large",
        input_type: "document",
      }),
    });

    if (!voyageResp.ok) {
      const errText = await voyageResp.text();
      console.error("Voyage embedding error:", errText);
      const status = voyageResp.status === 429 ? 429 : 502;
      return new Response(
        JSON.stringify({
          error: "Embedding failed",
          detail: errText.substring(0, 500),
          status: voyageResp.status,
        }),
        {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const voyageData = await voyageResp.json();
    const embeddings = voyageData.data as Array<{
      embedding: number[];
      index: number;
    }>;

    if (!embeddings || embeddings.length !== chunks.length) {
      return new Response(
        JSON.stringify({
          error: "Embedding count mismatch",
          expected: chunks.length,
          got: embeddings?.length ?? 0,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ----------------------------------------------------------------
    // Step 3: Insert chunks into meeting_chunks
    // ----------------------------------------------------------------
    const rows = chunks.map((c, i) => ({
      meeting_id,
      user_id: userId,
      chunk_index: c.chunk_index,
      topic_label: c.topic_label,
      chunk_text: c.chunk_text,
      speakers: c.speakers,
      start_time_offset: c.start_time_offset,
      end_time_offset: c.end_time_offset,
      token_count: c.token_count,
      embedding: JSON.stringify(embeddings[i].embedding),
    }));

    const { error: insertErr } = await adminClient
      .from("meeting_chunks")
      .insert(rows);

    if (insertErr) {
      console.error("Failed to insert chunks:", insertErr);
      return new Response(
        JSON.stringify({ error: "Failed to insert chunks", detail: insertErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Mark meeting as embedded
    await adminClient
      .from("meetings")
      .update({ embedded_at: new Date().toISOString() })
      .eq("id", meeting_id);

    const totalTokens = chunks.reduce((sum, c) => sum + c.token_count, 0);

    return new Response(
      JSON.stringify({
        ok: true,
        meeting_id,
        chunks_created: chunks.length,
        total_tokens_estimated: totalTokens,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function extractTimestamp(line: string | undefined): string | null {
  if (!line) return null;
  const match = line.match(/\[(\d{2}:\d{2})\]/);
  return match ? match[1] : null;
}

function extractSpeakers(lines: string[]): string[] {
  const speakers = new Set<string>();
  for (const line of lines) {
    const match = line.match(/\[\d{2}:\d{2}\]\s+(.+?):/);
    if (match) {
      speakers.add(match[1].trim());
    }
  }
  return [...speakers].sort();
}
