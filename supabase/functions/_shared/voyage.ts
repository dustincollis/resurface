// Voyage AI embedding helper.
// Uses voyage-3-large (1024 dimensions) to match the vector(1024) schema.
// Called exclusively from edge functions — VOYAGE_API_KEY never leaves the backend.

const VOYAGE_BASE = "https://api.voyageai.com/v1";
const MODEL = "voyage-3-large";
const BATCH_SIZE = 128; // Voyage allows up to 128 texts per request

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = Deno.env.get("VOYAGE_API_KEY");
  if (!apiKey) throw new Error("VOYAGE_API_KEY not set");

  const results: number[][] = [];

  // Process in batches to stay under API limits
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${VOYAGE_BASE}/embeddings`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        input: batch,
        input_type: "document",
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Voyage API error ${res.status}: ${body}`);
    }

    const json = await res.json();
    // Voyage returns data sorted by index
    const embeddings = (json.data as { index: number; embedding: number[] }[])
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    results.push(...embeddings);
  }

  return results;
}

export async function embedQuery(text: string): Promise<number[]> {
  const apiKey = Deno.env.get("VOYAGE_API_KEY");
  if (!apiKey) throw new Error("VOYAGE_API_KEY not set");

  const res = await fetch(`${VOYAGE_BASE}/embeddings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      input: [text],
      input_type: "query",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API error ${res.status}: ${body}`);
  }

  const json = await res.json();
  return (json.data as { index: number; embedding: number[] }[])[0].embedding;
}
