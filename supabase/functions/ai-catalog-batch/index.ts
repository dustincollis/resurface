// ai-catalog-batch
//
// Runs a single cheap Sonnet call across a batch of `inputs` rows to decide
// which ones warrant the expensive per-input synthesis. Skipped inputs get
// marked as such (with a reason) and never generate proposals. Actionable
// inputs trigger ai-parse-input in the background (fire-and-forget).
//
// The catalog call also groups obvious email-thread replies, so downstream
// dedupe can treat them as a unit. A thread_group_id (uuid) is written to
// every input in the group.
//
// Returns immediately with {actionable, skipped} counts. Synthesis runs in
// the background via EdgeRuntime.waitUntil — the user navigates away and
// proposals land as they're processed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import { recordAiCall } from "../_shared/telemetry.ts";

const CATALOG_MODEL = "claude-sonnet-4-6";
// Max bytes of body text to include per input in the catalog prompt. Triage
// decisions don't need the full body — snippet is usually enough to identify
// banal replies vs. real commitments.
const BODY_SNIPPET_LEN = 500;

interface InputRow {
  id: string;
  user_id: string;
  input_type: "email" | "screenshot" | "pasted_text";
  title: string;
  user_description: string | null;
  raw_text: string | null;
  metadata: Record<string, unknown>;
  triage_result: string | null;
}

interface CatalogEntry {
  input_id: string;
  decision: "process" | "skip";
  reason: string;
  thread_id?: string;
}

// Deno global for background work. Not in the standard types.
// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

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

    const body = await req.json() as {
      input_ids?: string[];
      user_context?: string;
    };
    const inputIds = Array.isArray(body.input_ids) ? body.input_ids : [];
    if (inputIds.length === 0) {
      return new Response(JSON.stringify({ error: "input_ids required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user } } = await adminClient.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inputsData, error: inputsErr } = await adminClient
      .from("inputs")
      .select("id, user_id, input_type, title, user_description, raw_text, metadata, triage_result")
      .in("id", inputIds);
    if (inputsErr) {
      return new Response(JSON.stringify({ error: inputsErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const inputs = (inputsData ?? []) as InputRow[];
    const ownInputs = inputs.filter((i) => i.user_id === user.id);
    // Skip inputs that were already triaged (avoids re-charging for retries
    // and overwriting user 'Process anyway' decisions).
    const candidates = ownInputs.filter((i) => i.triage_result === null);

    // Screenshots don't have text to pre-classify; send them straight to
    // per-input synthesis without burning a catalog call on them.
    const textual = candidates.filter((i) => i.input_type !== "screenshot");
    const screenshots = candidates.filter((i) => i.input_type === "screenshot");

    let catalogEntries: CatalogEntry[] = [];
    if (textual.length > 0) {
      catalogEntries = await runCatalog({
        anthropicKey,
        adminClient,
        userId: user.id,
        inputs: textual,
        userContext: typeof body.user_context === "string" ? body.user_context : "",
      });
    }

    // Apply catalog decisions + write triage_result/reason to each input.
    // Thread groups: assign a shared uuid to every input that shares a
    // thread_id returned from the model.
    const threadIdMap = new Map<string, string>();
    for (const e of catalogEntries) {
      if (e.thread_id && !threadIdMap.has(e.thread_id)) {
        threadIdMap.set(e.thread_id, crypto.randomUUID());
      }
    }

    const updates: Promise<unknown>[] = [];
    const actionableIds: string[] = [];

    for (const entry of catalogEntries) {
      const status = entry.decision === "process" ? "actionable" : "skipped";
      const threadGroupId = entry.thread_id ? threadIdMap.get(entry.thread_id) ?? null : null;
      updates.push(
        adminClient
          .from("inputs")
          .update({
            triage_result: status,
            triage_reason: entry.reason,
            thread_group_id: threadGroupId,
          })
          .eq("id", entry.input_id)
      );
      if (status === "actionable") actionableIds.push(entry.input_id);
    }

    // Screenshots are always actionable (no text to pre-filter).
    for (const s of screenshots) {
      updates.push(
        adminClient
          .from("inputs")
          .update({
            triage_result: "actionable",
            triage_reason: "screenshot — triage skipped",
          })
          .eq("id", s.id)
      );
      actionableIds.push(s.id);
    }

    await Promise.allSettled(updates);

    // Fire per-input synthesis for actionable inputs in the background. The
    // response returns immediately with counts; proposals land as they finish.
    const userContext = typeof body.user_context === "string" ? body.user_context : "";
    if (typeof EdgeRuntime !== "undefined" && actionableIds.length > 0) {
      EdgeRuntime.waitUntil(
        fireSynthesis({
          supabaseUrl,
          token,
          inputIds: actionableIds,
          userContext,
        })
      );
    } else if (actionableIds.length > 0) {
      // Fallback: no EdgeRuntime (local dev?). Fire and don't await so the
      // response isn't blocked waiting for N synthesis calls.
      fireSynthesis({ supabaseUrl, token, inputIds: actionableIds, userContext }).catch(
        (err) => console.error("[ai-catalog-batch] background synthesis error:", err)
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        total_inputs: candidates.length,
        actionable: actionableIds.length,
        skipped: catalogEntries.filter((e) => e.decision === "skip").length,
        thread_groups_detected: threadIdMap.size,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[ai-catalog-batch] fatal:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ----------------------------------------------------------------------------
// Catalog call
// ----------------------------------------------------------------------------

interface CatalogArgs {
  anthropicKey: string;
  // deno-lint-ignore no-explicit-any
  adminClient: any;
  userId: string;
  inputs: InputRow[];
  userContext: string;
}

async function runCatalog(args: CatalogArgs): Promise<CatalogEntry[]> {
  const { anthropicKey, adminClient, userId, inputs, userContext } = args;

  const entriesBlock = inputs.map((inp, idx) => {
    const meta = (inp.metadata ?? {}) as Record<string, unknown>;
    const subject = (meta.subject as string | undefined) ?? inp.title ?? "";
    const from = (meta.from as string | undefined) ?? "";
    const date = (meta.date as string | undefined) ?? "";
    const snippet = (inp.raw_text ?? "").substring(0, BODY_SNIPPET_LEN).replace(/\s+/g, " ").trim();
    const userDesc = inp.user_description ? ` [user note: ${inp.user_description}]` : "";
    return `[${idx}] ID=${inp.id}
  FROM: ${from}
  SUBJECT: ${subject}
  DATE: ${date}${userDesc}
  SNIPPET: ${snippet}`;
  }).join("\n\n");

  const system = `You are triaging incoming emails and text snippets for a sales professional (EPAM Content GTM lead). Your job is to decide which ones contain anything worth remembering — commitments, action items, decisions, meeting context, facts about people or companies, strategic signals.

Be generous about what counts as "actionable":
- Any explicit or implied commitment ("I'll send…", "we should…", "by Friday")
- Any decision made or question raised
- Any substantive information about a deal, client, or counterpart (tone, relationship, position)
- Any request directed at the user (even phrased casually)

SKIP only if the input is genuinely empty of signal:
- Pure FYI/thanks replies with no content beyond acknowledgment
- Automated confirmations, receipts, "you've been added to" notifications
- Duplicate content already covered by another input in this batch (mark the duplicates as skip; keep the canonical one)
- Calendar noise with no discussion

Also identify email threads: if two or more inputs in the batch are replies in the same conversation (same subject line minus RE:/FWD:, or explicit quoted history), assign them the same thread_id string (any short label works — "t1", "t2", etc.).

Return ONLY a JSON object, no prose:
{
  "entries": [
    {"input_id": "<uuid>", "decision": "process" | "skip", "reason": "<short explanation>", "thread_id": "<optional>"}
  ]
}

The reason field is ~5-15 words. For skips, say why ("fyi reply, no commitments" / "automated confirmation" / "duplicate of thread t1"). For process, briefly say what's there ("commitment from Holly", "decision on pricing", "new contact Alice").`;

  const userMsg = `${userContext ? userContext + "\n\n" : ""}Triage these ${inputs.length} inputs:\n\n${entriesBlock}`;

  const startTime = Date.now();
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CATALOG_MODEL,
        max_tokens: 4096,
        temperature: 0.1,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userMsg }],
      }),
    });
  } catch (err) {
    console.error("[catalog] network error:", err);
    await markAllFailed(adminClient, inputs, "catalog network error");
    return [];
  }

  const latencyMs = Date.now() - startTime;

  if (!resp.ok) {
    const detail = await resp.text();
    console.error("[catalog] api error:", resp.status, detail.substring(0, 500));
    await markAllFailed(adminClient, inputs, `catalog api error: ${resp.status}`);
    return [];
  }

  const aiJson = await resp.json();

  // Telemetry
  try {
    await recordAiCall(adminClient, {
      user_id: userId,
      function_name: "ai-catalog-batch",
      model: CATALOG_MODEL,
      usage: aiJson.usage,
      stop_reason: aiJson.stop_reason ?? null,
      latency_ms: latencyMs,
      metadata: { input_count: inputs.length },
    });
  } catch (err) {
    console.error("[catalog] telemetry error:", err);
  }

  const raw = (aiJson.content?.[0]?.text ?? "").trim();
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");

  let parsed: { entries?: CatalogEntry[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("[catalog] parse failed:", err, "raw:", raw.substring(0, 300));
    await markAllFailed(adminClient, inputs, "catalog response not parseable");
    return [];
  }

  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];

  // Safety: the model might omit some inputs. Mark any missing input as
  // actionable-by-default (fail-open) so we don't silently drop signal.
  const seen = new Set(entries.map((e) => e.input_id));
  for (const inp of inputs) {
    if (!seen.has(inp.id)) {
      entries.push({
        input_id: inp.id,
        decision: "process",
        reason: "omitted from catalog — fail-open to synthesis",
      });
    }
  }

  return entries;
}

// deno-lint-ignore no-explicit-any
async function markAllFailed(adminClient: any, inputs: InputRow[], reason: string) {
  await Promise.allSettled(
    inputs.map((i) =>
      adminClient
        .from("inputs")
        .update({ triage_result: "failed", triage_reason: reason })
        .eq("id", i.id)
    )
  );
}

// ----------------------------------------------------------------------------
// Background synthesis dispatch
// ----------------------------------------------------------------------------
// Fires ai-parse-input for every actionable input. Sequential to avoid
// hitting Anthropic rate limits with large batches; concurrency can be added
// later if needed. Each failure is logged and the input's processing_error
// is set by ai-parse-input itself.

interface SynthesisArgs {
  supabaseUrl: string;
  token: string;
  inputIds: string[];
  userContext: string;
}

async function fireSynthesis(args: SynthesisArgs): Promise<void> {
  const { supabaseUrl, token, inputIds, userContext } = args;
  for (const id of inputIds) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/ai-parse-input`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ input_id: id, user_context: userContext }),
      });
      if (!res.ok) {
        const detail = await res.text();
        console.error(`[catalog-bg] parse-input failed for ${id}:`, res.status, detail.substring(0, 300));
      }
    } catch (err) {
      console.error(`[catalog-bg] parse-input error for ${id}:`, err);
    }
  }
}
