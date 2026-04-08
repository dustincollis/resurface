import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Fetch all active items (not done or dropped)
    const { data: items, error } = await adminClient
      .from("items")
      .select("id, last_touched_at, stakes, due_date, status")
      .not("status", "in", '("done","dropped")');

    if (error) {
      console.error("Error fetching items:", error);
      return new Response(JSON.stringify({ error: "Failed to fetch items" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = Date.now();
    let updatedCount = 0;

    for (const item of items) {
      const hoursSinceTouch =
        (now - new Date(item.last_touched_at).getTime()) / (1000 * 60 * 60);
      const baseDecay = Math.log2(hoursSinceTouch + 1) * 10;
      const stakesMultiplier = (item.stakes ?? 3) * 5;

      let deadlineUrgency = 0;
      if (item.due_date) {
        const dueDate = new Date(item.due_date);
        const hoursUntilDue = (dueDate.getTime() - now) / (1000 * 60 * 60);
        if (hoursUntilDue < 0) {
          deadlineUrgency = 100;
        } else if (hoursUntilDue < 24) {
          deadlineUrgency = 50;
        } else if (hoursUntilDue < 72) {
          deadlineUrgency = 25;
        }
      }

      const stalenessScore = baseDecay + stakesMultiplier + deadlineUrgency;

      const { error: updateError } = await adminClient
        .from("items")
        .update({ staleness_score: stalenessScore })
        .eq("id", item.id);

      if (!updateError) {
        updatedCount++;
      }
    }

    // Zero out done/dropped items
    await adminClient
      .from("items")
      .update({ staleness_score: 0 })
      .in("status", ["done", "dropped"]);

    return new Response(JSON.stringify({ updated: updatedCount }), {
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
