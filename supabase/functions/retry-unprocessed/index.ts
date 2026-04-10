// retry-unprocessed: safety net for meetings that have a transcript but
// were never processed (processed_at IS NULL). Re-triggers the parser.
//
// Decoupled from compute-staleness (C3 cleanup). Should run on its own
// cron schedule (e.g., every 15 minutes).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: unprocessed } = await adminClient
      .from("meetings")
      .select("id, transcript")
      .is("processed_at", null)
      .not("transcript", "is", null)
      .limit(5);

    let parsedCount = 0;
    for (const meeting of unprocessed ?? []) {
      const transcript = meeting.transcript as string | null;
      if (!transcript || transcript.length < 100) continue;

      console.log(`[retry-unprocessed] re-triggering parse for meeting ${meeting.id}`);
      try {
        const parseRes = await fetch(
          `${supabaseUrl}/functions/v1/ai-parse-transcript`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({ meeting_id: meeting.id }),
          }
        );
        if (parseRes.ok) {
          parsedCount++;
        } else {
          const detail = await parseRes.text();
          console.error(
            `[retry-unprocessed] parse failed for ${meeting.id}:`,
            parseRes.status,
            detail.substring(0, 200)
          );
        }
      } catch (err) {
        console.error(`[retry-unprocessed] error for ${meeting.id}:`, err);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        unprocessed_found: (unprocessed ?? []).length,
        parsed: parsedCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[retry-unprocessed] error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
