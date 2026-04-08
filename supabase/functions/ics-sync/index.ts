import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

// Simple ICS parser — extracts VEVENT blocks
function parseICS(icsText: string) {
  const events: Record<string, string>[] = [];
  const lines = icsText.replace(/\r\n /g, "").split(/\r?\n/);
  let current: Record<string, string> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
    } else if (line === "END:VEVENT" && current) {
      events.push(current);
      current = null;
    } else if (current) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.substring(0, colonIdx).split(";")[0];
        const value = line.substring(colonIdx + 1);
        current[key] = value;
      }
    }
  }
  return events;
}

function parseICSDate(value: string): string | null {
  if (!value) return null;
  // Handle YYYYMMDDTHHMMSSZ format
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/
  );
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
  }
  // Handle YYYYMMDD format (all-day events)
  const dateMatch = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateMatch) {
    return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T00:00:00Z`;
  }
  return null;
}

function parseAttendees(event: Record<string, string>): string[] {
  const attendees: string[] = [];
  for (const [key, value] of Object.entries(event)) {
    if (key.startsWith("ATTENDEE")) {
      const email = value.replace("mailto:", "").trim();
      if (email) attendees.push(email);
    }
  }
  return attendees;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Get user_id from request (for manual trigger) or process all users (for cron)
    let userIds: string[] = [];
    const authHeader = req.headers.get("Authorization");

    if (authHeader) {
      // Manual trigger: sync for the requesting user
      const userClient = createClient(supabaseUrl, serviceRoleKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
      } = await userClient.auth.getUser();
      if (user) userIds = [user.id];
    } else {
      // Cron trigger: sync for all users with ICS URLs
      const { data: profiles } = await adminClient
        .from("profiles")
        .select("id, settings")
        .not("settings->ics_feed_url", "is", null);

      if (profiles) {
        userIds = profiles
          .filter(
            (p) =>
              (p.settings as Record<string, unknown>)?.ics_feed_url
          )
          .map((p) => p.id);
      }
    }

    let totalSynced = 0;

    for (const userId of userIds) {
      // Get the user's ICS URL
      const { data: profile } = await adminClient
        .from("profiles")
        .select("settings")
        .eq("id", userId)
        .single();

      const icsUrl = (profile?.settings as Record<string, unknown>)
        ?.ics_feed_url as string | undefined;
      if (!icsUrl) continue;

      // Fetch the ICS feed
      let icsText: string;
      try {
        const response = await fetch(icsUrl);
        if (!response.ok) continue;
        icsText = await response.text();
      } catch {
        console.error(`Failed to fetch ICS for user ${userId}`);
        continue;
      }

      // Parse events
      const events = parseICS(icsText);

      for (const event of events) {
        const uid = event.UID;
        if (!uid) continue;

        const title = (event.SUMMARY ?? "Untitled Event").replace(/\\,/g, ",").replace(/\\n/g, "\n");
        const startTime = parseICSDate(event.DTSTART ?? "");
        const endTime = parseICSDate(event.DTEND ?? "");
        const location = event.LOCATION?.replace(/\\,/g, ",") ?? null;
        const attendees = parseAttendees(event);

        // Upsert by ics_uid
        await adminClient.from("meetings").upsert(
          {
            user_id: userId,
            ics_uid: uid,
            title,
            start_time: startTime,
            end_time: endTime,
            location,
            attendees,
            source: "ics_import",
          },
          { onConflict: "user_id,ics_uid" }
        );

        totalSynced++;
      }
    }

    return new Response(
      JSON.stringify({
        synced: totalSynced,
        users_processed: userIds.length,
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
