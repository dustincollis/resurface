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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SB_SERVICE_ROLE_KEY")!;
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

    // Read the user's current bio
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("settings")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const settings = (profile.settings as Record<string, unknown>) ?? {};
    const rawBio = (settings.bio as string)?.trim();

    if (!rawBio) {
      // Empty bio: clear the distilled version too
      await adminClient
        .from("profiles")
        .update({
          settings: {
            ...settings,
            bio_distilled: null,
            bio_distilled_at: null,
          },
        })
        .eq("id", user.id);
      return new Response(JSON.stringify({ distilled: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If bio is already very short, skip distillation
    if (rawBio.length < 80) {
      await adminClient
        .from("profiles")
        .update({
          settings: {
            ...settings,
            bio_distilled: rawBio,
            bio_distilled_at: new Date().toISOString(),
          },
        })
        .eq("id", user.id);
      return new Response(JSON.stringify({ distilled: rawBio }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call Claude to distill
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
        temperature: 0.3,
        messages: [
          {
            role: "user",
            content: `Distill this self-description into a tight 2-4 sentence profile capturing the most useful context for an AI task management assistant. Focus on:
- Their role and current work
- The kinds of work they manage (people, projects, deals, etc.)
- Any preferences, constraints, or working style mentioned
- Domain expertise

Skip fluff, hobbies (unless work-relevant), and biography unless directly relevant.

Write in third person, as a factual profile. Plain text, no markdown.

Self-description:
${rawBio}

Distilled profile:`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", errText);
      // Fall back to using raw bio
      await adminClient
        .from("profiles")
        .update({
          settings: {
            ...settings,
            bio_distilled: rawBio,
            bio_distilled_at: new Date().toISOString(),
          },
        })
        .eq("id", user.id);
      return new Response(
        JSON.stringify({ distilled: rawBio, fallback: true }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiResponse = await response.json();
    const distilled = (aiResponse.content?.[0]?.text ?? rawBio).trim();

    await adminClient
      .from("profiles")
      .update({
        settings: {
          ...settings,
          bio_distilled: distilled,
          bio_distilled_at: new Date().toISOString(),
        },
      })
      .eq("id", user.id);

    return new Response(JSON.stringify({ distilled }), {
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
