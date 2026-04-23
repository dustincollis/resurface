// backfill-pursuit-links: one-shot sweep over a user's existing active-mode
// meetings, asking the pursuit-matcher whether any should be linked to an
// active pursuit. Writes pending pursuit_link_proposals; never auto-applies.
//
// Called manually (usually once per deployment). Idempotent: meetings already
// linked or already proposed for a given pursuit are skipped by the matcher.
//
// Body: { user_id?: string, limit?: number, since?: string (ISO date), dry_run?: boolean }
// - user_id: required if caller is service-role; inferred from JWT otherwise
// - limit: max meetings to process this run (default 500)
// - since: only consider meetings with start_time >= this date
// - dry_run: count candidates, don't call matcher

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import { suggestPursuitLink } from "../_shared/pursuit-matcher.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Resolve user_id: prefer JWT if present, else require in body.
    const body = await req.json().catch(() => ({})) as {
      user_id?: string;
      limit?: number;
      since?: string;
      dry_run?: boolean;
    };

    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      if (token !== serviceRoleKey) {
        const { data: { user } } = await adminClient.auth.getUser(token);
        if (user) userId = user.id;
      }
    }
    if (!userId && body.user_id) userId = body.user_id;
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "user_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const limit = typeof body.limit === "number" && body.limit > 0 ? Math.min(body.limit, 1000) : 500;
    const dryRun = body.dry_run === true;

    // Pull candidate meetings: active mode, parsed (has transcript_summary),
    // newest first so the user sees recent hits on their current pursuits.
    let query = adminClient
      .from("meetings")
      .select("id, title, transcript_summary, extracted_decisions, attendees, start_time")
      .eq("user_id", userId)
      .eq("import_mode", "active")
      .not("transcript_summary", "is", null)
      .order("start_time", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (body.since) {
      query = query.gte("start_time", body.since);
    }

    const { data: meetings, error: meetingsErr } = await query;
    if (meetingsErr) {
      return new Response(
        JSON.stringify({ error: meetingsErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const candidates = meetings ?? [];

    if (dryRun) {
      return new Response(
        JSON.stringify({
          ok: true,
          dry_run: true,
          candidate_count: candidates.length,
          oldest: candidates[candidates.length - 1]?.start_time ?? null,
          newest: candidates[0]?.start_time ?? null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let linksCreated = 0;
    let meetingsProcessed = 0;
    const errors: Array<{ meeting_id: string; error: string }> = [];

    for (const m of candidates) {
      meetingsProcessed++;
      try {
        const decisionsRaw = m.extracted_decisions;
        const decisions: string[] = Array.isArray(decisionsRaw)
          ? decisionsRaw.filter((d: unknown): d is string => typeof d === "string")
          : [];

        const created = await suggestPursuitLink({
          anthropicKey,
          adminClient,
          userId,
          meetingId: m.id as string,
          meetingTitle: (m.title as string | null) ?? "",
          meetingSummary: (m.transcript_summary as string | null) ?? "",
          attendees: (m.attendees as string[] | null) ?? [],
          // We don't persist company on meetings; matcher degrades gracefully
          // (name + attendee-domain signals still fire).
          discussionCompany: null,
          decisions,
        });
        linksCreated += created;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[backfill-pursuit-links] error for ${m.id}:`, msg);
        errors.push({ meeting_id: m.id as string, error: msg });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        meetings_processed: meetingsProcessed,
        links_created: linksCreated,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[backfill-pursuit-links] fatal:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
