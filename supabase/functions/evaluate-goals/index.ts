// evaluate-goals: evaluates computed milestone conditions for all active goals.
//
// For each non-manual milestone in an active goal, checks the linked entity's
// current state against the target condition. Updates condition_met and
// evidence_text accordingly.
//
// Can be called:
//  - On-demand from the goal detail page (single goal)
//  - From a cron job (all active goals)
//  - After an entity status change (triggered by webhook/function)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY")!;

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
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

    const body = await req.json().catch(() => ({}));
    const goalId = body?.goal_id as string | undefined;

    // Fetch active goals (or a specific one)
    let goalsQuery = admin
      .from("goals")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "active");

    if (goalId) {
      goalsQuery = goalsQuery.eq("id", goalId);
    }

    const { data: goals } = await goalsQuery;
    if (!goals || goals.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, evaluated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const goalIds = goals.map((g) => g.id);

    // Fetch all non-manual milestones for these goals
    const { data: milestones } = await admin
      .from("goal_tasks")
      .select("*")
      .in("goal_id", goalIds)
      .neq("condition_type", "manual")
      .neq("status", "skipped");

    let evaluated = 0;
    let changed = 0;

    for (const ms of milestones ?? []) {
      let met = false;
      let evidence = "";

      switch (ms.condition_type) {
        case "pursuit": {
          if (ms.linked_entity_id) {
            const { data: pursuit } = await admin
              .from("pursuits")
              .select("name, status")
              .eq("id", ms.linked_entity_id)
              .maybeSingle();

            if (pursuit) {
              const target = ms.target_status ?? "won";
              met = pursuit.status === target;
              evidence = met
                ? `Pursuit "${pursuit.name}" reached status: ${pursuit.status}`
                : `Pursuit "${pursuit.name}" is ${pursuit.status} (needs: ${target})`;
            }
          }
          break;
        }

        case "item": {
          if (ms.linked_entity_id) {
            const { data: item } = await admin
              .from("items")
              .select("title, status")
              .eq("id", ms.linked_entity_id)
              .maybeSingle();

            if (item) {
              const target = ms.target_status ?? "done";
              met = item.status === target;
              evidence = met
                ? `Item "${item.title}" is ${item.status}`
                : `Item "${item.title}" is ${item.status} (needs: ${target})`;
            }
          }
          break;
        }

        case "commitment": {
          if (ms.linked_entity_id) {
            const { data: commitment } = await admin
              .from("commitments")
              .select("title, status")
              .eq("id", ms.linked_entity_id)
              .maybeSingle();

            if (commitment) {
              const target = ms.target_status ?? "met";
              met = commitment.status === target;
              evidence = met
                ? `Commitment "${commitment.title}" is ${commitment.status}`
                : `Commitment "${commitment.title}" is ${commitment.status} (needs: ${target})`;
            }
          }
          break;
        }

        case "meeting": {
          // Check if a meeting exists matching criteria in condition_config
          const config = (ms.condition_config ?? {}) as {
            company_id?: string;
            person_id?: string;
            after_date?: string;
            title_contains?: string;
          };

          let query = admin
            .from("meetings")
            .select("id, title, start_time")
            .eq("user_id", userId)
            .not("transcript", "is", null);

          if (config.after_date) {
            query = query.gte("start_time", config.after_date);
          }
          if (config.title_contains) {
            query = query.ilike("title", `%${config.title_contains}%`);
          }

          const { data: meetings } = await query.limit(5);

          // If person_id filter, check meeting_attendees
          if (config.person_id && meetings && meetings.length > 0) {
            const meetingIds = meetings.map((m) => m.id);
            const { data: attendeeLinks } = await admin
              .from("meeting_attendees")
              .select("meeting_id")
              .eq("person_id", config.person_id)
              .in("meeting_id", meetingIds);

            const matchingIds = new Set((attendeeLinks ?? []).map((a) => a.meeting_id));
            const match = meetings.find((m) => matchingIds.has(m.id));
            met = !!match;
            evidence = match
              ? `Meeting "${match.title}" on ${new Date(match.start_time).toLocaleDateString()}`
              : "No matching meeting found";
          } else {
            met = (meetings ?? []).length > 0;
            if (met && meetings) {
              evidence = `Meeting "${meetings[0].title}" on ${new Date(meetings[0].start_time).toLocaleDateString()}`;
            }
          }
          break;
        }

        case "count": {
          const config = (ms.condition_config ?? {}) as {
            entity_type: string; // 'pursuit' | 'item' | 'commitment' | 'meeting'
            filter_status?: string;
            filter_company_id?: string;
            threshold: number;
          };

          const entityType = config.entity_type ?? "pursuit";
          const threshold = config.threshold ?? 1;
          let count = 0;

          if (entityType === "pursuit") {
            let q = admin.from("pursuits").select("id", { count: "exact", head: true }).eq("user_id", userId);
            if (config.filter_status) q = q.eq("status", config.filter_status);
            if (config.filter_company_id) q = q.eq("company_id", config.filter_company_id);
            const { count: c } = await q;
            count = c ?? 0;
          } else if (entityType === "item") {
            let q = admin.from("items").select("id", { count: "exact", head: true }).eq("user_id", userId);
            if (config.filter_status) q = q.eq("status", config.filter_status);
            if (config.filter_company_id) q = q.eq("company_id", config.filter_company_id);
            const { count: c } = await q;
            count = c ?? 0;
          } else if (entityType === "commitment") {
            let q = admin.from("commitments").select("id", { count: "exact", head: true }).eq("user_id", userId);
            if (config.filter_status) q = q.eq("status", config.filter_status);
            if (config.filter_company_id) q = q.eq("company_id", config.filter_company_id);
            const { count: c } = await q;
            count = c ?? 0;
          } else if (entityType === "meeting") {
            let q = admin.from("meetings").select("id", { count: "exact", head: true }).eq("user_id", userId);
            if (config.filter_company_id) {
              // Would need to join through meeting_attendees → people → companies
              // For now, use title-based filter
            }
            const { count: c } = await q;
            count = c ?? 0;
          }

          met = count >= threshold;
          evidence = `${count} of ${threshold} ${entityType}s${config.filter_status ? ` (status: ${config.filter_status})` : ""}`;
          break;
        }
      }

      // Update if changed
      const updates: Record<string, unknown> = {
        last_evaluated_at: new Date().toISOString(),
        evidence_text: evidence,
      };

      if (met !== ms.condition_met) {
        updates.condition_met = met;
        // Auto-mark as done if condition newly met
        if (met && ms.status !== "done") {
          updates.status = "done";
          updates.completed_at = new Date().toISOString();
        }
        // Revert to in_progress if condition was met but now isn't
        if (!met && ms.status === "done" && ms.condition_type !== "manual") {
          updates.status = "in_progress";
          updates.completed_at = null;
        }
        changed++;
      }

      await admin.from("goal_tasks").update(updates).eq("id", ms.id);
      evaluated++;
    }

    return new Response(
      JSON.stringify({ ok: true, evaluated, changed, goals: goalIds.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[evaluate-goals] error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
