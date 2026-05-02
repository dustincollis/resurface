import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import { embedTexts } from "../_shared/voyage.ts";

type CorpusTable = "ideas" | "memories" | "commitments" | "meetings";

type CorpusRow = {
  id: string;
  user_id: string;
  embedding: number[] | string | null;
  title?: string | null;
  description?: string | null;
  evidence_text?: string | null;
  context_notes?: string | null;
  content?: string | null;
  transcript_summary?: string | null;
};

type Caller =
  | { kind: "service_role" }
  | { kind: "user"; userId: string }
  | { kind: "anonymous" };

const TABLES: CorpusTable[] = ["ideas", "memories", "commitments", "meetings"];
const BACKFILL_LIMIT = 200;
const MAX_TEXT_LENGTH = 6000;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isCorpusTable(value: unknown): value is CorpusTable {
  return typeof value === "string" && TABLES.includes(value as CorpusTable);
}

function selectColumns(table: CorpusTable) {
  switch (table) {
    case "ideas":
      return "id, user_id, embedding, title, description, evidence_text, context_notes";
    case "memories":
      return "id, user_id, embedding, content";
    case "commitments":
      return "id, user_id, embedding, title, description, evidence_text";
    case "meetings":
      return "id, user_id, embedding, title, transcript_summary";
  }
}

function rowText(table: CorpusTable, row: CorpusRow) {
  const parts =
    table === "ideas"
      ? [row.title, row.description, row.evidence_text, row.context_notes]
      : table === "memories"
        ? [row.content]
        : table === "commitments"
          ? [row.title, row.description, row.evidence_text]
          : [row.title, row.transcript_summary];

  return parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_TEXT_LENGTH);
}

async function resolveCaller(
  req: Request,
  admin: ReturnType<typeof createClient>,
  serviceRoleKey: string,
): Promise<Caller> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const apiKeyHeader = req.headers.get("apikey") ?? req.headers.get("ApiKey") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if ((token && token === serviceRoleKey) || apiKeyHeader === serviceRoleKey) {
    return { kind: "service_role" };
  }

  if (!token) {
    return { kind: "anonymous" };
  }

  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) {
    return { kind: "anonymous" };
  }

  return { kind: "user", userId: user.id };
}

async function fetchRow(
  admin: ReturnType<typeof createClient>,
  table: CorpusTable,
  id: string,
) {
  const { data, error } = await admin
    .from(table)
    .select(selectColumns(table))
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as CorpusRow | null;
}

async function writeEmbedding(
  admin: ReturnType<typeof createClient>,
  table: CorpusTable,
  id: string,
  embedding: number[],
) {
  const { error } = await admin
    .from(table)
    .update({ embedding: JSON.stringify(embedding) })
    .eq("id", id);

  if (error) throw error;
}

async function embedSingle(
  admin: ReturnType<typeof createClient>,
  caller: Caller,
  defaultUserId: string | null,
  body: Record<string, unknown>,
) {
  if (!isCorpusTable(body.table)) {
    return jsonResponse({ error: "table must be ideas, memories, commitments, or meetings" }, 400);
  }

  if (typeof body.id !== "string" || body.id.length === 0) {
    return jsonResponse({ error: "id required" }, 400);
  }

  const row = await fetchRow(admin, body.table, body.id);
  if (!row) return jsonResponse({ error: "Row not found" }, 404);

  if (caller.kind === "anonymous") {
    if (!defaultUserId || row.user_id !== defaultUserId) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
  } else if (caller.kind === "user" && row.user_id !== caller.userId) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const force = body.force === true && caller.kind === "service_role";
  if (row.embedding && !force) {
    return jsonResponse({
      ok: true,
      mode: "single",
      table: body.table,
      id: body.id,
      skipped: true,
      reason: "already_embedded",
    });
  }

  const text = rowText(body.table, row);
  if (!text) {
    return jsonResponse({
      ok: true,
      mode: "single",
      table: body.table,
      id: body.id,
      skipped: true,
      reason: "blank_text",
    });
  }

  const [embedding] = await embedTexts([text]);
  await writeEmbedding(admin, body.table, body.id, embedding);

  return jsonResponse({
    ok: true,
    mode: "single",
    table: body.table,
    id: body.id,
    embedded: 1,
  });
}

async function embedBackfill(
  admin: ReturnType<typeof createClient>,
  caller: Caller,
) {
  if (caller.kind !== "service_role") {
    return jsonResponse({ error: "Backfill requires service-role authorization" }, 403);
  }

  const candidates: Array<{ table: CorpusTable; row: CorpusRow; text: string }> = [];
  const skippedBlank: Record<CorpusTable, number> = {
    ideas: 0,
    memories: 0,
    commitments: 0,
    meetings: 0,
  };

  for (const table of TABLES) {
    const remaining = BACKFILL_LIMIT - candidates.length;
    if (remaining <= 0) break;

    const { data, error } = await admin
      .from(table)
      .select(selectColumns(table))
      .is("embedding", null)
      .order("created_at", { ascending: false })
      .limit(remaining);

    if (error) throw error;

    for (const row of (data ?? []) as CorpusRow[]) {
      const text = rowText(table, row);
      if (!text) {
        skippedBlank[table] += 1;
        continue;
      }
      candidates.push({ table, row, text });
    }
  }

  const counts: Record<CorpusTable, number> = {
    ideas: 0,
    memories: 0,
    commitments: 0,
    meetings: 0,
  };

  const embeddings = await embedTexts(candidates.map((candidate) => candidate.text));

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    await writeEmbedding(admin, candidate.table, candidate.row.id, embeddings[i]);
    counts[candidate.table] += 1;
  }

  return jsonResponse({
    ok: true,
    mode: "backfill",
    embedded: candidates.length,
    remaining_hint: candidates.length === BACKFILL_LIMIT ? "more_rows_possible" : "no_more_rows_seen",
    counts,
    skipped_blank: skippedBlank,
  });
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
    const defaultUserId = Deno.env.get("RESURFACE_DEFAULT_USER_ID") ?? null;
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const caller = await resolveCaller(req, admin, serviceRoleKey);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    if (body.mode === "single") {
      return await embedSingle(admin, caller, defaultUserId, body);
    }

    if (body.mode === "backfill") {
      return await embedBackfill(admin, caller);
    }

    return jsonResponse({ error: "mode must be single or backfill" }, 400);
  } catch (error) {
    console.error(error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});
