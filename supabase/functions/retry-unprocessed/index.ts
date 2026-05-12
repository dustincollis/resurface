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
    // Both env vars now exist in prod. ?? doesn't fall through on empty
    // strings, so use || with explicit "" defaults — mirrors the pattern
    // ai-parse-transcript uses. Picking the wrong one means the parser
    // gets "Bearer " and rejects with "Missing authorization".
    const serviceRoleKeyLegacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const serviceRoleKeyNew = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";
    const serviceRoleKey = serviceRoleKeyNew || serviceRoleKeyLegacy;
    if (!serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "No service role key in env" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: unprocessed } = await adminClient
      .from("meetings")
      .select("id, transcript")
      .is("processed_at", null)
      .not("transcript", "is", null);

    let parsedCount = 0;
    const failures: Array<{ meeting_id: string; status?: number; detail: string }> = [];
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
            detail.substring(0, 500)
          );
          failures.push({ meeting_id: meeting.id, status: parseRes.status, detail: detail.substring(0, 1000) });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[retry-unprocessed] error for ${meeting.id}:`, err);
        failures.push({ meeting_id: meeting.id, detail: msg });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        unprocessed_found: (unprocessed ?? []).length,
        parsed: parsedCount,
        failures,
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
