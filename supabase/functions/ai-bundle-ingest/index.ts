import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";
import { embedTexts } from "../_shared/voyage.ts";
import { createIdentityResolver } from "../_shared/resolve-identity.ts";
import { recordAiCall } from "../_shared/telemetry.ts";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

// ============================================================
// Section chunker
// Parse a markdown document into sections using ## and ### headers.
// Returns chunks with a human-readable section_path like "Schedule > Monday".
// ============================================================
interface Chunk {
  section_path: string;
  content: string;
}

function chunkMarkdown(title: string, markdown: string): Chunk[] {
  const lines = markdown.split("\n");
  const chunks: Chunk[] = [];

  let h2 = title;
  let h3 = "";
  let buffer: string[] = [];

  function flush() {
    const text = buffer.join("\n").trim();
    if (text.length < 30) return; // Skip near-empty sections
    const path = h3 ? `${h2} > ${h3}` : h2;
    chunks.push({ section_path: path, content: text });
    buffer = [];
  }

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      h2 = line.replace(/^##\s+/, "").trim();
      h3 = "";
      buffer = [line];
    } else if (line.startsWith("### ")) {
      flush();
      h3 = line.replace(/^###\s+/, "").trim();
      buffer = [line];
    } else {
      buffer.push(line);
    }
  }
  flush();

  // If no sections were detected (flat doc), treat whole doc as one chunk
  if (chunks.length === 0 && markdown.trim().length > 30) {
    chunks.push({ section_path: title, content: markdown.trim() });
  }

  return chunks;
}

// ============================================================
// Entity + gap extraction via Claude
// ============================================================
interface ExtractionResult {
  people: string[];
  companies: string[];
  gaps: string[];
}

async function extractEntitiesAndGaps(
  combinedMarkdown: string,
  anthropicKey: string
): Promise<ExtractionResult> {
  const systemPrompt = `You extract structured data from event briefing documents.
Return ONLY valid JSON — no markdown, no explanation.`;

  const userPrompt = `From the following briefing document, extract:
1. "people" — an array of all named individuals mentioned (first + last name as they appear, deduplicated)
2. "companies" — an array of all named companies / organizations mentioned (as they appear, deduplicated)
3. "gaps" — an array of open questions, unknowns, or unresolved items (often found in a "Gaps", "Open Items", or "Unknowns" section, or any bullet that contains "TBD", "unknown", "unclear", "need to confirm", "open question")

Return this exact JSON shape:
{
  "people": ["Name One", "Name Two"],
  "companies": ["Company A", "Company B"],
  "gaps": ["Gap description one", "Gap description two"]
}

BRIEFING:
${combinedMarkdown.slice(0, 40000)}`;

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-7",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude entity extraction failed ${res.status}: ${body}`);
  }

  const data = await res.json();
  const raw = data.content?.[0]?.text ?? "{}";

  try {
    const parsed = JSON.parse(raw);
    return {
      people: Array.isArray(parsed.people) ? parsed.people : [],
      companies: Array.isArray(parsed.companies) ? parsed.companies : [],
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
    };
  } catch {
    console.error("[ingest] entity JSON parse failed:", raw.slice(0, 200));
    return { people: [], companies: [], gaps: [] };
  }
}

// ============================================================
// Main handler
// ============================================================
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SB_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      "";
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Auth — verify JWT and extract user_id
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    const { bundle_id, documents } = await req.json() as {
      bundle_id: string;
      documents: { title: string; content_md: string }[];
    };

    if (!bundle_id || !Array.isArray(documents) || documents.length === 0) {
      return new Response(
        JSON.stringify({ error: "bundle_id and documents[] required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify bundle ownership
    const { data: bundle, error: bundleError } = await adminClient
      .from("bundles")
      .select("id")
      .eq("id", bundle_id)
      .eq("user_id", userId)
      .single();

    if (bundleError || !bundle) {
      return new Response(JSON.stringify({ error: "Bundle not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark bundle as ingesting
    await adminClient
      .from("bundles")
      .update({ status: "ingesting", updated_at: new Date().toISOString() })
      .eq("id", bundle_id);

    // --------------------------------------------------------
    // Step 1: Clear any existing ingest data (reset support)
    // --------------------------------------------------------
    await Promise.all([
      adminClient.from("bundle_chunks").delete().eq("bundle_id", bundle_id),
      adminClient.from("bundle_documents").delete().eq("bundle_id", bundle_id),
      adminClient.from("bundle_entities").delete().eq("bundle_id", bundle_id),
      adminClient.from("bundle_gaps").delete().eq("bundle_id", bundle_id),
    ]);

    // --------------------------------------------------------
    // Step 2: Insert documents + chunk all content
    // --------------------------------------------------------
    const allChunks: (Chunk & { document_id: string; position: number })[] = [];
    const combinedMarkdown: string[] = [];

    for (let di = 0; di < documents.length; di++) {
      const doc = documents[di];
      const { data: insertedDoc, error: docInsertError } = await adminClient
        .from("bundle_documents")
        .insert({
          bundle_id,
          title: doc.title,
          content_md: doc.content_md,
          position: di,
        })
        .select("id")
        .single();

      if (docInsertError || !insertedDoc) {
        throw new Error(`Failed to insert document: ${docInsertError?.message}`);
      }

      combinedMarkdown.push(`# ${doc.title}\n\n${doc.content_md}`);

      const chunks = chunkMarkdown(doc.title, doc.content_md);
      chunks.forEach((chunk, ci) => {
        allChunks.push({
          ...chunk,
          document_id: insertedDoc.id,
          position: ci,
        });
      });
    }

    console.log(`[ingest] ${allChunks.length} chunks across ${documents.length} documents`);

    // --------------------------------------------------------
    // Step 3: Embed all chunks via Voyage
    // --------------------------------------------------------
    const chunkTexts = allChunks.map(
      (c) => `${c.section_path}\n\n${c.content}`
    );
    const embeddings = await embedTexts(chunkTexts);

    // --------------------------------------------------------
    // Step 4: Insert chunks with embeddings
    // --------------------------------------------------------
    const chunkRows = allChunks.map((chunk, i) => ({
      bundle_id,
      document_id: chunk.document_id,
      section_path: chunk.section_path,
      content: chunk.content,
      embedding: JSON.stringify(embeddings[i]),
      token_count: Math.ceil(chunk.content.length / 4), // rough estimate
      position: chunk.position,
    }));

    // Insert in batches of 50 to avoid payload limits
    for (let i = 0; i < chunkRows.length; i += 50) {
      const batch = chunkRows.slice(i, i + 50);
      const { error: chunkError } = await adminClient
        .from("bundle_chunks")
        .insert(batch);
      if (chunkError) throw new Error(`Chunk insert failed: ${chunkError.message}`);
    }

    // --------------------------------------------------------
    // Step 5: Extract entities + gaps via Claude Haiku
    // --------------------------------------------------------
    const t0 = Date.now();
    const extracted = await extractEntitiesAndGaps(
      combinedMarkdown.join("\n\n---\n\n"),
      anthropicKey
    );
    const latencyMs = Date.now() - t0;

    // Record entity extraction telemetry (lightweight — Haiku, no usage returned from helper)
    await recordAiCall(adminClient, {
      user_id: userId,
      function_name: "ai-bundle-ingest",
      model: "claude-opus-4-7",
      usage: null,
      latency_ms: latencyMs,
      source_type: "bundle",
      source_id: bundle_id,
      metadata: { phase: "entity_extraction" },
    });

    // --------------------------------------------------------
    // Step 6: Resolve entities against Resurface people/companies
    // --------------------------------------------------------
    const resolver = createIdentityResolver(adminClient, userId);
    await resolver.preload();

    // Insert people entities (resolve when possible, insert raw name always)
    const peopleRows = await Promise.all(
      extracted.people.slice(0, 300).map(async (name) => {
        let entity_id: string | null = null;
        try {
          entity_id = await resolver.resolvePerson({ raw: name });
        } catch {
          // Name didn't resolve to existing person — entity_id stays null
        }
        return {
          bundle_id,
          entity_type: "person",
          entity_id,
          raw_name: name,
          mention_count: 1,
        };
      })
    );

    // Deduplicate by lower(raw_name) before insert
    const uniquePeople = Array.from(
      new Map(peopleRows.map((r) => [r.raw_name.toLowerCase(), r])).values()
    );

    // Insert companies (no resolver for now — just store raw names)
    const uniqueCompanies = Array.from(
      new Set(extracted.companies.map((c) => c.toLowerCase()))
    ).map((nameLower) => ({
      bundle_id,
      entity_type: "company" as const,
      entity_id: null as string | null,
      raw_name: extracted.companies.find((c) => c.toLowerCase() === nameLower) ?? nameLower,
      mention_count: 1,
    }));

    if (uniquePeople.length > 0) {
      await adminClient
        .from("bundle_entities")
        .upsert(uniquePeople, { onConflict: "bundle_id,entity_type,raw_name", ignoreDuplicates: true });
    }
    if (uniqueCompanies.length > 0) {
      await adminClient
        .from("bundle_entities")
        .upsert(uniqueCompanies, { onConflict: "bundle_id,entity_type,raw_name", ignoreDuplicates: true });
    }

    // --------------------------------------------------------
    // Step 7: Insert gaps
    // --------------------------------------------------------
    if (extracted.gaps.length > 0) {
      const gapRows = extracted.gaps.slice(0, 50).map((content, i) => ({
        bundle_id,
        content,
        state: "open",
        position: i,
      }));
      await adminClient.from("bundle_gaps").insert(gapRows);
    }

    // --------------------------------------------------------
    // Step 8: Mark bundle ready
    // --------------------------------------------------------
    await adminClient
      .from("bundles")
      .update({ status: "ready", updated_at: new Date().toISOString() })
      .eq("id", bundle_id);

    return new Response(
      JSON.stringify({
        ok: true,
        chunks: chunkRows.length,
        people: uniquePeople.length,
        companies: uniqueCompanies.length,
        gaps: extracted.gaps.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[ai-bundle-ingest] error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
