// process-partner-document
//
// Extracts content from an uploaded reference document attached to a
// partner, asks Claude to summarize + extract structured people and
// account mentions, and uses the existing identity resolver to upsert
// people rows tied to the partner — same path the meeting parser
// already uses, so the partner page's roster stays consistent.
//
// v1 supports application/pdf, .docx, image/png, image/jpeg, and text.
// PPTX and SVG are deferred. PDFs and images are sent to Claude's
// multimodal API directly; DOCX is unzipped and the document.xml is
// stripped to plain text before being passed in as a text block.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import JSZip from "https://esm.sh/jszip@3.10.1";
import { corsHeaders } from "../_shared/cors.ts";
import { createIdentityResolver } from "../_shared/resolve-identity.ts";

const STORAGE_BUCKET = "partner-docs";
const CLAUDE_MODEL = "claude-opus-4-6";

interface DocRow {
  id: string;
  user_id: string;
  company_id: string;
  title: string;
  kind: string;
  original_filename: string;
  mime_type: string;
  storage_path: string;
}

interface CompanyRow {
  id: string;
  name: string;
}

interface ExtractedPerson {
  name?: string;
  role?: string | null;
  territory?: string | null;
  region?: string | null;
  email?: string | null;
  notes?: string | null;
}

interface ExtractedAccount {
  name?: string;
  context?: string | null;
}

interface ParsedResponse {
  kind?: string;
  summary?: string;
  people?: ExtractedPerson[];
  accounts?: ExtractedAccount[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization" }, 401);
    }

    const { document_id } = await req.json();
    if (!document_id || typeof document_id !== "string") {
      return json({ error: "document_id required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller owns the document.
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user } } = await adminClient.auth.getUser(token);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: docRow, error: docErr } = await adminClient
      .from("partner_documents")
      .select("*")
      .eq("id", document_id)
      .single();
    if (docErr || !docRow) return json({ error: "Document not found" }, 404);
    const doc = docRow as DocRow;
    if (doc.user_id !== user.id) return json({ error: "Forbidden" }, 403);

    const { data: companyRow, error: cErr } = await adminClient
      .from("companies")
      .select("id, name")
      .eq("id", doc.company_id)
      .single();
    if (cErr || !companyRow) return json({ error: "Partner company not found" }, 404);
    const company = companyRow as CompanyRow;

    // Fetch the file from storage.
    const { data: fileData, error: dlErr } = await adminClient
      .storage
      .from(STORAGE_BUCKET)
      .download(doc.storage_path);
    if (dlErr || !fileData) {
      const msg = dlErr?.message ?? "download failed";
      await markFailure(adminClient, document_id, msg);
      return json({ error: "Failed to download file", detail: msg }, 500);
    }
    const buf = new Uint8Array(await fileData.arrayBuffer());

    // Build the user-message content blocks based on mime type. For PDF
    // and image, send native multimodal content. For DOCX, unzip and
    // extract text from word/document.xml (no external deps needed).
    let content: Array<Record<string, unknown>>;
    let extractedText: string | null = null;

    const mt = (doc.mime_type || "").toLowerCase();
    if (mt === "application/pdf" || doc.original_filename.toLowerCase().endsWith(".pdf")) {
      content = [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: bytesToBase64(buf) },
        },
        { type: "text", text: buildUserText(company.name) },
      ];
    } else if (
      mt === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      doc.original_filename.toLowerCase().endsWith(".docx")
    ) {
      try {
        extractedText = await extractDocxText(buf);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await markFailure(adminClient, document_id, `DOCX extraction failed: ${msg}`);
        return json({ error: "DOCX extraction failed", detail: msg }, 422);
      }
      content = [
        { type: "text", text: `${buildUserText(company.name)}\n\nDOCUMENT TEXT:\n\n${extractedText}` },
      ];
    } else if (mt.startsWith("image/")) {
      // Claude vision supports PNG, JPEG, GIF, WebP. Reject SVG explicitly
      // for now — text-only fallback will land in v2.
      if (mt === "image/svg+xml") {
        await markFailure(adminClient, document_id, "SVG is not yet supported (v1 limitation)");
        return json({ error: "SVG not yet supported" }, 422);
      }
      content = [
        {
          type: "image",
          source: { type: "base64", media_type: mt, data: bytesToBase64(buf) },
        },
        { type: "text", text: buildUserText(company.name) },
      ];
    } else if (mt === "text/plain" || mt === "text/markdown" || /\.(txt|md)$/i.test(doc.original_filename)) {
      extractedText = new TextDecoder().decode(buf);
      content = [
        { type: "text", text: `${buildUserText(company.name)}\n\nDOCUMENT TEXT:\n\n${extractedText}` },
      ];
    } else {
      await markFailure(adminClient, document_id, `Unsupported mime type: ${mt}`);
      return json({ error: "Unsupported mime type", detail: mt }, 415);
    }

    // Call Claude.
    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        temperature: 0.2,
        system: buildSystemPrompt(),
        messages: [{ role: "user", content }],
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      await markFailure(adminClient, document_id, `Claude error: ${errText.substring(0, 300)}`);
      return json({ error: "Claude API error", detail: errText.substring(0, 500) }, 502);
    }

    const aiJson = await aiResp.json();
    const raw = (aiJson.content?.[0]?.text ?? "").trim();
    const cleaned = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");

    let parsed: ParsedResponse;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markFailure(adminClient, document_id, `Bad JSON from Claude: ${msg}`);
      return json({ error: "Bad JSON from model", detail: raw.substring(0, 400) }, 502);
    }

    // Resolve people via the shared identity resolver — same code path
    // meeting parsing uses, so the partner's people roster on the page
    // stays a single source of truth.
    const resolver = createIdentityResolver(adminClient, user.id);
    const cleanPeople: ExtractedPerson[] = [];
    let peopleResolved = 0;
    for (const p of parsed.people ?? []) {
      const name = (p.name ?? "").trim();
      if (!name) continue;
      try {
        const personId = await resolver.resolvePerson({
          raw: p.email && isProbablyEmail(p.email) ? p.email : name,
          companyId: doc.company_id,
        });
        peopleResolved++;
        // Backfill role/notes only when the existing person row has them
        // blank — don't clobber curated data the user has set elsewhere.
        const updates: Record<string, unknown> = {};
        if (p.role) {
          const { data: existing } = await adminClient
            .from("people")
            .select("role, notes")
            .eq("id", personId)
            .single();
          if (!existing?.role) updates.role = p.role.trim();
          // Build territorial/region notes string if the doc supplied them
          const noteParts: string[] = [];
          if (p.territory) noteParts.push(`Territory: ${p.territory.trim()}`);
          if (p.region) noteParts.push(`Region: ${p.region.trim()}`);
          if (p.notes) noteParts.push(p.notes.trim());
          if (noteParts.length > 0 && !existing?.notes) {
            updates.notes = noteParts.join(". ");
          }
        }
        if (Object.keys(updates).length > 0) {
          await adminClient.from("people").update(updates).eq("id", personId);
        }
        cleanPeople.push({
          name,
          role: p.role ?? null,
          territory: p.territory ?? null,
          region: p.region ?? null,
          email: p.email ?? null,
          notes: p.notes ?? null,
        });
      } catch (err) {
        console.warn("[partner-doc] person resolve failed:", name, err);
      }
    }

    const cleanAccounts: ExtractedAccount[] = (parsed.accounts ?? [])
      .filter((a) => typeof a?.name === "string" && a.name.trim().length > 0)
      .map((a) => ({ name: a.name!.trim(), context: a.context ?? null }));

    const docKind = ALLOWED_KINDS.has(parsed.kind ?? "")
      ? (parsed.kind as string)
      : "other";

    const { error: updErr } = await adminClient
      .from("partner_documents")
      .update({
        extracted_text: extractedText, // null for PDFs/images — Claude read the binary directly
        summary: parsed.summary?.trim() ?? null,
        kind: docKind,
        extracted_people: cleanPeople,
        extracted_accounts: cleanAccounts,
        processed_at: new Date().toISOString(),
        processing_error: null,
      })
      .eq("id", document_id);
    if (updErr) {
      console.error("[partner-doc] update failed:", updErr);
      return json({ error: "Update failed", detail: updErr.message }, 500);
    }

    return json({
      document_id,
      summary_chars: parsed.summary?.length ?? 0,
      people_extracted: cleanPeople.length,
      people_resolved: peopleResolved,
      accounts_mentioned: cleanAccounts.length,
      kind: docKind,
    });
  } catch (err) {
    console.error("[process-partner-document] unexpected:", err);
    return json({ error: "internal", detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});

const ALLOWED_KINDS = new Set([
  "org_chart",
  "team_structure",
  "capability_brief",
  "contract",
  "other",
]);

function buildSystemPrompt(): string {
  return `You are extracting structured information from a reference document about a business partner. The user uploads these to add depth to the partner's profile in their account management system.

Your task: read the document, classify what kind it is, write a tight summary, and identify every person mentioned with a role at the partner organization plus any client/customer accounts referenced.

Be precise. Don't invent people or accounts that aren't in the document. Don't include the user themselves or people clearly at the user's own company. Skip generic placeholder names.

Return ONLY a JSON object — no markdown wrapping, no code fences, no prose before or after.

Schema:
{
  "kind": "org_chart" | "team_structure" | "capability_brief" | "contract" | "other",
  "summary": "2-3 paragraphs (~150 words total). What role this doc plays. Key personnel and responsibilities. Organizational structure. Don't repeat the doc verbatim.",
  "people": [
    {
      "name": "First Last",
      "role": "Job title / function — e.g. 'Head of Alliances'",
      "territory": "States or accounts they cover, if specified — e.g. 'MN, WI, IA, IL, MO, KS, CO, UT, NM, TX, OK, AR, LA'",
      "region": "Higher-level region if applicable — e.g. 'EMEA', 'North America'",
      "email": "if present in the doc",
      "notes": "any other concrete attribute worth keeping — e.g. 'covers retail/apparel North America'"
    }
  ],
  "accounts": [
    {
      "name": "Client/customer name as written",
      "context": "short note on how it appears — e.g. 'rep covers this account', 'pursuit in progress'"
    }
  ]
}`;
}

function buildUserText(partnerName: string): string {
  return `This document is reference material about ${partnerName}. Extract per the schema in the system prompt.`;
}

async function extractDocxText(buf: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("DOCX is missing word/document.xml");
  const xml = await docXmlFile.async("string");
  // Strip tags. Rough but adequate for the partner-info docs we see —
  // tables/lists collapse to whitespace-joined runs of text. Fancier
  // mammoth-style conversion is overkill here.
  const stripped = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  // Decode the few entities our regex missed.
  return stripped
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function isProbablyEmail(s: string): boolean {
  return /@/.test(s) && /\.[a-z]{2,}$/i.test(s);
}

// deno-lint-ignore no-explicit-any
async function markFailure(client: any, docId: string, message: string): Promise<void> {
  await client
    .from("partner_documents")
    .update({ processing_error: message.substring(0, 500), processed_at: null })
    .eq("id", docId);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
