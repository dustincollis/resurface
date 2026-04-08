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

    const { item_id } = await req.json();
    if (!item_id) {
      return new Response(JSON.stringify({ error: "item_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    // Create user client to verify ownership
    const userClient = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin client for reads/writes
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Fetch the item
    const { data: item, error: itemError } = await adminClient
      .from("items")
      .select("*")
      .eq("id", item_id)
      .eq("user_id", user.id)
      .single();

    if (itemError || !item) {
      return new Response(JSON.stringify({ error: "Item not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch user's streams
    const { data: streams } = await adminClient
      .from("streams")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_archived", false)
      .order("sort_order");

    if (!streams || streams.length === 0) {
      return new Response(
        JSON.stringify({ message: "No streams to classify into" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const streamsDescription = streams
      .map(
        (s: { id: string; name: string; field_templates: unknown[] }) =>
          `- "${s.name}" (id: ${s.id}, fields: ${JSON.stringify(s.field_templates)})`
      )
      .join("\n");

    // Call Claude
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        temperature: 0.3,
        messages: [
          {
            role: "user",
            content: `You are classifying a task into one of the user's work streams.

Available streams:
${streamsDescription}

Task title: "${item.title}"
Task description: "${item.description || ""}"

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "stream_id": "the-matching-stream-id-or-null",
  "confidence": 0.0-1.0,
  "custom_fields": {},
  "suggested_next_action": "a concrete next step"
}

If no stream fits well, set stream_id to null and confidence to 0.
For custom_fields, generate key-value pairs that match the stream's field_templates if applicable.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", errText);
      return new Response(
        JSON.stringify({ error: "AI classification failed" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiResponse = await response.json();
    const content = aiResponse.content?.[0]?.text;

    let classification;
    try {
      classification = JSON.parse(content);
    } catch {
      console.error("Failed to parse AI response:", content);
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Update the item with AI suggestions
    const updates: Record<string, unknown> = {
      ai_suggested_stream: classification.stream_id
        ? streams.find(
            (s: { id: string }) => s.id === classification.stream_id
          )?.name || null
        : null,
      ai_confidence: classification.confidence,
    };

    // Only set stream_id if confidence is high and item doesn't already have one
    if (classification.stream_id && classification.confidence > 0.7 && !item.stream_id) {
      updates.stream_id = classification.stream_id;
    }

    // Merge custom fields
    if (
      classification.custom_fields &&
      Object.keys(classification.custom_fields).length > 0
    ) {
      updates.custom_fields = {
        ...item.custom_fields,
        ...classification.custom_fields,
      };
    }

    // Set next_action if not already set
    if (classification.suggested_next_action && !item.next_action) {
      updates.next_action = classification.suggested_next_action;
    }

    await adminClient.from("items").update(updates).eq("id", item_id);

    return new Response(JSON.stringify({ classification, updates }), {
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
