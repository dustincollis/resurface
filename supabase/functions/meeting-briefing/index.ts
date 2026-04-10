// meeting-briefing: generates a pre-meeting briefing for a given meeting.
//
// Looks up the meeting's attendees, finds relevant open commitments,
// recent meetings, and pursuit context for each person, then uses
// Claude to generate a concise briefing.
//
// Called from the frontend when a user opens a future meeting's detail page.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

interface PersonContext {
  person_id: string;
  name: string;
  company: string | null;
  role: string | null;
  commitments_you_owe: { title: string; do_by: string | null; status: string }[];
  commitments_they_owe: { title: string; do_by: string | null; status: string }[];
  recent_meetings: { title: string; date: string }[];
  shared_pursuits: { name: string; status: string }[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth: require user JWT or service role
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY")!;

    // Determine user from JWT
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();

    // Also allow service role (for cron/automation)
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === serviceRoleKey;

    if (!user && !isServiceRole) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user?.id ?? Deno.env.get("RESURFACE_DEFAULT_USER_ID")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => null);
    const meetingId = body?.meeting_id as string | undefined;
    if (!meetingId) {
      return new Response(
        JSON.stringify({ error: "meeting_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch meeting with its attendees
    const { data: meeting } = await admin
      .from("meetings")
      .select("id, title, start_time, end_time, attendees")
      .eq("id", meetingId)
      .eq("user_id", userId)
      .single();

    if (!meeting) {
      return new Response(
        JSON.stringify({ error: "Meeting not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get linked people from meeting_attendees junction
    const { data: attendeeLinks } = await admin
      .from("meeting_attendees")
      .select("person_id, people(id, name, email, company_id, role, companies(name))")
      .eq("meeting_id", meetingId);

    const people = (attendeeLinks ?? [])
      .map((a) => (a as unknown as { people: Record<string, unknown> }).people)
      .filter(Boolean);

    if (people.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          meeting_id: meetingId,
          briefing: null,
          message: "No resolved attendees for this meeting",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For each person, gather context
    const personContexts: PersonContext[] = [];

    for (const p of people) {
      const personId = p.id as string;
      const companyObj = p.companies as { name: string } | null;

      // Open commitments involving this person
      const { data: commitments } = await admin
        .from("commitments")
        .select("title, do_by, status, direction")
        .eq("user_id", userId)
        .eq("person_id", personId)
        .in("status", ["open", "waiting"]);

      const youOwe = (commitments ?? [])
        .filter((c) => c.direction === "outgoing")
        .map((c) => ({ title: c.title, do_by: c.do_by, status: c.status }));

      const theyOwe = (commitments ?? [])
        .filter((c) => c.direction === "incoming")
        .map((c) => ({ title: c.title, do_by: c.do_by, status: c.status }));

      // Recent meetings with this person (last 5, excluding current)
      const { data: recentMeetingLinks } = await admin
        .from("meeting_attendees")
        .select("meeting_id, meetings(title, start_time)")
        .eq("person_id", personId)
        .neq("meeting_id", meetingId)
        .order("added_at", { ascending: false })
        .limit(5);

      const recentMeetings = (recentMeetingLinks ?? [])
        .map((l) => {
          const m = (l as unknown as { meetings: Record<string, unknown> }).meetings;
          return m ? {
            title: m.title as string,
            date: m.start_time ? new Date(m.start_time as string).toLocaleDateString() : "unknown",
          } : null;
        })
        .filter(Boolean) as { title: string; date: string }[];

      // Shared pursuits: find pursuits this person's company is linked to
      const sharedPursuits: { name: string; status: string }[] = [];
      if (p.company_id) {
        const { data: pursuits } = await admin
          .from("pursuits")
          .select("name, status")
          .eq("user_id", userId)
          .eq("company_id", p.company_id as string)
          .eq("status", "active");
        for (const pu of pursuits ?? []) {
          sharedPursuits.push({ name: pu.name, status: pu.status });
        }
      }

      personContexts.push({
        person_id: personId,
        name: p.name as string,
        company: companyObj?.name ?? null,
        role: p.role as string | null,
        commitments_you_owe: youOwe,
        commitments_they_owe: theyOwe,
        recent_meetings: recentMeetings,
        shared_pursuits: sharedPursuits,
      });
    }

    // Generate briefing with Claude
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      // Return structured data without AI summary
      return new Response(
        JSON.stringify({
          ok: true,
          meeting_id: meetingId,
          meeting_title: meeting.title,
          meeting_time: meeting.start_time,
          attendees: personContexts,
          briefing: null,
          message: "ANTHROPIC_API_KEY not set — returning raw context",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contextBlock = personContexts.map((pc) => {
      const lines = [`## ${pc.name}${pc.company ? ` (${pc.company})` : ""}${pc.role ? ` — ${pc.role}` : ""}`];

      if (pc.commitments_you_owe.length > 0) {
        lines.push("**You owe them:**");
        for (const c of pc.commitments_you_owe) {
          const due = c.do_by ? ` (due ${c.do_by})` : "";
          lines.push(`- ${c.title}${due}`);
        }
      }
      if (pc.commitments_they_owe.length > 0) {
        lines.push("**They owe you:**");
        for (const c of pc.commitments_they_owe) {
          const due = c.do_by ? ` (due ${c.do_by})` : "";
          lines.push(`- ${c.title}${due}`);
        }
      }
      if (pc.recent_meetings.length > 0) {
        lines.push("**Recent meetings:**");
        for (const m of pc.recent_meetings) {
          lines.push(`- ${m.title} (${m.date})`);
        }
      }
      if (pc.shared_pursuits.length > 0) {
        lines.push("**Active pursuits:**");
        for (const pu of pc.shared_pursuits) {
          lines.push(`- ${pu.name}`);
        }
      }
      if (pc.commitments_you_owe.length === 0 && pc.commitments_they_owe.length === 0 && pc.recent_meetings.length === 0) {
        lines.push("*No prior commitments or meetings on record.*");
      }

      return lines.join("\n");
    }).join("\n\n");

    const prompt = `You are a meeting preparation assistant for a sales/account executive. Generate a concise pre-meeting briefing.

Meeting: "${meeting.title}"
Time: ${meeting.start_time ? new Date(meeting.start_time).toLocaleString() : "TBD"}

Here is the context for each attendee:

${contextBlock}

Write a briefing that:
1. Opens with a 1-2 sentence summary of what this meeting likely involves based on the title and attendees
2. Lists the key things to address — overdue commitments first, then open items
3. Notes any relationship context worth knowing (how recently you've met, active pursuits)
4. Closes with 2-3 suggested success conditions for this meeting

Keep it tight — under 300 words. Use markdown formatting. Don't be sycophantic or overly formal.`;

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    let briefingText: string | null = null;
    if (aiResponse.ok) {
      const aiBody = await aiResponse.json();
      briefingText = aiBody.content?.[0]?.text ?? null;
    } else {
      console.error("[meeting-briefing] AI call failed:", aiResponse.status);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        meeting_id: meetingId,
        meeting_title: meeting.title,
        meeting_time: meeting.start_time,
        attendees: personContexts,
        briefing: briefingText,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[meeting-briefing] error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
