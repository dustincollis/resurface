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

    const { code, redirect_uri } = await req.json();
    if (!code || !redirect_uri) {
      return new Response(
        JSON.stringify({ error: "code and redirect_uri required" }),
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
    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
    const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;

    if (!clientId || !clientSecret) {
      return new Response(
        JSON.stringify({
          error: "Microsoft credentials not configured on the server",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

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

    // Exchange authorization code for tokens
    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri,
      grant_type: "authorization_code",
      scope: "Calendars.Read offline_access User.Read",
    });

    const tokenResponse = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
      }
    );

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error("Microsoft token exchange failed:", errText);
      return new Response(
        JSON.stringify({
          error: "Token exchange failed",
          details: errText,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const tokens = await tokenResponse.json();
    const refreshToken = tokens.refresh_token;
    const accessToken = tokens.access_token;

    if (!refreshToken) {
      return new Response(
        JSON.stringify({
          error: "No refresh token received. Make sure offline_access scope is requested.",
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get the user's Microsoft account email/displayName
    let accountEmail: string | null = null;
    try {
      const meResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (meResponse.ok) {
        const me = await meResponse.json();
        accountEmail = me.mail ?? me.userPrincipalName ?? null;
      }
    } catch (err) {
      console.error("Failed to fetch /me:", err);
    }

    // Read existing settings to merge
    const { data: profile } = await adminClient
      .from("profiles")
      .select("settings")
      .eq("id", user.id)
      .single();

    const existingSettings = (profile?.settings as Record<string, unknown>) ?? {};

    await adminClient
      .from("profiles")
      .update({
        settings: {
          ...existingSettings,
          microsoft: {
            refresh_token: refreshToken,
            account_email: accountEmail,
            connected_at: new Date().toISOString(),
          },
        },
      })
      .eq("id", user.id);

    return new Response(
      JSON.stringify({ success: true, account_email: accountEmail }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
