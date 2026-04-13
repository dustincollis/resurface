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

    const { query, limit = 20, threshold = 0.3 } = await req.json();
    if (!query || typeof query !== "string" || query.trim().length < 2) {
      return new Response(
        JSON.stringify({ error: "query is required (min 2 chars)" }),
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
    const voyageKey = Deno.env.get("VOYAGE_API_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Auth: service role or user JWT
    const apiKeyHeader =
      req.headers.get("apikey") ?? req.headers.get("ApiKey") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isServiceRole =
      (serviceRoleKey && token === serviceRoleKey) ||
      (serviceRoleKey && apiKeyHeader === serviceRoleKey);

    let userId: string;
    if (isServiceRole) {
      // For service role, require user_id in body
      const body = await req.clone().json().catch(() => ({}));
      if (!body.user_id) {
        return new Response(
          JSON.stringify({ error: "user_id required for service role calls" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      userId = body.user_id;
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
      userId = user.id;
    }

    // Embed the query via Voyage (input_type: "query" for search)
    const voyageResp = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${voyageKey}`,
      },
      body: JSON.stringify({
        input: [query.trim()],
        model: "voyage-3-large",
        input_type: "query",
      }),
    });

    if (!voyageResp.ok) {
      const errText = await voyageResp.text();
      console.error("Voyage query embedding error:", errText);
      return new Response(
        JSON.stringify({
          error: "Failed to embed query",
          detail: errText.substring(0, 500),
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const voyageData = await voyageResp.json();
    const queryEmbedding = voyageData.data?.[0]?.embedding;
    if (!queryEmbedding) {
      return new Response(
        JSON.stringify({ error: "No embedding returned from Voyage" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Call the search RPC
    const { data: results, error: searchErr } = await adminClient.rpc(
      "search_meeting_chunks",
      {
        query_embedding: JSON.stringify(queryEmbedding),
        searching_user_id: userId,
        match_count: Math.min(limit, 50),
        similarity_threshold: threshold,
      }
    );

    if (searchErr) {
      console.error("Search RPC error:", searchErr);
      return new Response(
        JSON.stringify({ error: "Search failed", detail: searchErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        query: query.trim(),
        results: results ?? [],
        count: results?.length ?? 0,
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
