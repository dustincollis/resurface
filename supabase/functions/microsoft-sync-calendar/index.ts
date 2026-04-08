import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

interface MicrosoftSettings {
  refresh_token: string;
  account_email?: string | null;
  connected_at?: string;
}

interface GraphEvent {
  id: string;
  subject?: string;
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  location?: { displayName?: string };
  attendees?: { emailAddress: { address: string; name?: string } }[];
  body?: { contentType: string; content: string };
  isCancelled?: boolean;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ access_token: string; refresh_token: string } | null> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: "Calendars.Read offline_access User.Read",
  });

  const response = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error("Token refresh failed:", errText);
    return null;
  }

  const tokens = await response.json();
  return {
    access_token: tokens.access_token,
    // Microsoft may rotate the refresh token; if so use the new one
    refresh_token: tokens.refresh_token ?? refreshToken,
  };
}

async function syncUser(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  settings: Record<string, unknown>,
  clientId: string,
  clientSecret: string
): Promise<{ synced: number; error?: string }> {
  const microsoft = settings.microsoft as MicrosoftSettings | undefined;
  if (!microsoft?.refresh_token) {
    return { synced: 0, error: "Not connected" };
  }

  // Get fresh access token
  const tokens = await refreshAccessToken(
    microsoft.refresh_token,
    clientId,
    clientSecret
  );
  if (!tokens) {
    return { synced: 0, error: "Failed to refresh token. Please reconnect." };
  }

  // If refresh token rotated, update it
  if (tokens.refresh_token !== microsoft.refresh_token) {
    await adminClient
      .from("profiles")
      .update({
        settings: {
          ...settings,
          microsoft: {
            ...microsoft,
            refresh_token: tokens.refresh_token,
          },
        },
      })
      .eq("id", userId);
  }

  // Calendar window: 7 days back to 60 days forward
  const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

  const url = `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=200&$orderby=start/dateTime&$select=id,subject,start,end,location,attendees,body,isCancelled`;

  const eventsResponse = await fetch(url, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Prefer: 'outlook.timezone="UTC"',
    },
  });

  if (!eventsResponse.ok) {
    const errText = await eventsResponse.text();
    console.error("Graph API call failed:", errText);
    return { synced: 0, error: `Graph API error: ${eventsResponse.status}` };
  }

  const data = await eventsResponse.json();
  const events = (data.value ?? []) as GraphEvent[];

  let synced = 0;
  for (const event of events) {
    if (event.isCancelled) continue;

    const title = event.subject ?? "Untitled Event";
    const startTime = event.start?.dateTime
      ? new Date(event.start.dateTime + "Z").toISOString()
      : null;
    const endTime = event.end?.dateTime
      ? new Date(event.end.dateTime + "Z").toISOString()
      : null;
    const location = event.location?.displayName ?? null;
    const attendees =
      event.attendees?.map((a) => a.emailAddress.address).filter(Boolean) ??
      [];

    let bodyText: string | null = null;
    if (event.body?.content) {
      const text =
        event.body.contentType === "html"
          ? htmlToText(event.body.content)
          : event.body.content.trim();
      if (text) {
        bodyText = text.substring(0, 5000);
      }
    }

    // Check if a record exists to avoid overwriting an existing transcript
    const { data: existing } = await adminClient
      .from("meetings")
      .select("id, transcript")
      .eq("user_id", userId)
      .eq("ics_uid", event.id)
      .maybeSingle();

    const upsertPayload: Record<string, unknown> = {
      user_id: userId,
      ics_uid: event.id,
      title,
      start_time: startTime,
      end_time: endTime,
      location,
      attendees,
      source: "ics_import",
    };

    // Only set transcript from event body if no transcript exists yet
    if (bodyText && !existing?.transcript) {
      upsertPayload.transcript = bodyText;
    }

    const { error } = await adminClient
      .from("meetings")
      .upsert(upsertPayload, { onConflict: "user_id,ics_uid" });

    if (!error) synced++;
  }

  return { synced };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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

    const authHeader = req.headers.get("Authorization");
    let userIds: string[] = [];

    if (authHeader) {
      // Manual trigger: sync only the requesting user
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
      userIds = [user.id];
    } else {
      // Cron trigger: all users with Microsoft connected
      const { data: profiles } = await adminClient
        .from("profiles")
        .select("id, settings")
        .not("settings->microsoft", "is", null);

      if (profiles) {
        userIds = profiles
          .filter(
            (p) =>
              ((p.settings as Record<string, unknown>)
                ?.microsoft as MicrosoftSettings | undefined)?.refresh_token
          )
          .map((p) => p.id);
      }
    }

    let totalSynced = 0;
    const errors: { user_id: string; error: string }[] = [];

    for (const userId of userIds) {
      const { data: profile } = await adminClient
        .from("profiles")
        .select("settings")
        .eq("id", userId)
        .single();

      const result = await syncUser(
        adminClient,
        userId,
        (profile?.settings as Record<string, unknown>) ?? {},
        clientId,
        clientSecret
      );

      totalSynced += result.synced;
      if (result.error) {
        errors.push({ user_id: userId, error: result.error });
      }

      // Update last_synced_at
      if (result.synced > 0 || !result.error) {
        const { data: latest } = await adminClient
          .from("profiles")
          .select("settings")
          .eq("id", userId)
          .single();

        const latestSettings =
          (latest?.settings as Record<string, unknown>) ?? {};
        const microsoft = (latestSettings.microsoft ??
          {}) as MicrosoftSettings;

        await adminClient
          .from("profiles")
          .update({
            settings: {
              ...latestSettings,
              microsoft: {
                ...microsoft,
                last_synced_at: new Date().toISOString(),
              },
            },
          })
          .eq("id", userId);
      }
    }

    return new Response(
      JSON.stringify({
        synced: totalSynced,
        users_processed: userIds.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
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
