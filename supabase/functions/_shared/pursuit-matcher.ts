// Pursuit-link matcher: shared between ai-parse-transcript (post-parse) and
// backfill-pursuit-links (one-shot sweep over historical meetings).
//
// Two stages: (1) deterministic pre-filter scores each active pursuit on
// company match, name mentions, and attendee-domain overlap. (2) if any
// candidate survives, Claude picks zero or one from the shortlist with
// confidence >= 0.7. Strong deterministic matches skip the LLM.
//
// Result is always a pending row in pursuit_link_proposals — never
// auto-applied. Safe to call repeatedly: bails out if the meeting is
// already linked or already proposed for any candidate pursuit.

export interface PursuitLinkArgs {
  anthropicKey: string;
  // deno-lint-ignore no-explicit-any
  adminClient: any;
  userId: string;
  meetingId: string;
  meetingTitle: string;
  meetingSummary: string;
  attendees: string[];
  discussionCompany: string | null;
  decisions: string[];
}

interface PursuitCandidate {
  id: string;
  name: string;
  description: string | null;
  company: string | null;
}

export async function suggestPursuitLink(args: PursuitLinkArgs): Promise<number> {
  const {
    anthropicKey, adminClient, userId, meetingId,
    meetingTitle, meetingSummary, attendees, discussionCompany, decisions,
  } = args;

  const { data: pursuitsData, error: pursuitsErr } = await adminClient
    .from("pursuits")
    .select("id, name, description, company")
    .eq("user_id", userId)
    .eq("status", "active");
  if (pursuitsErr) {
    console.error("[pursuit-link] failed to load pursuits:", pursuitsErr);
    return 0;
  }
  const pursuits = (pursuitsData ?? []) as PursuitCandidate[];
  if (pursuits.length === 0) return 0;

  const { data: existingMembers } = await adminClient
    .from("pursuit_members")
    .select("pursuit_id")
    .eq("member_type", "meeting")
    .eq("member_id", meetingId);
  const linkedPursuitIds = new Set(
    ((existingMembers ?? []) as Array<{ pursuit_id: string }>).map((m) => m.pursuit_id)
  );

  const { data: existingProposals } = await adminClient
    .from("pursuit_link_proposals")
    .select("suggested_pursuit_id")
    .eq("source_meeting_id", meetingId);
  const alreadyProposedIds = new Set(
    ((existingProposals ?? []) as Array<{ suggested_pursuit_id: string }>)
      .map((p) => p.suggested_pursuit_id)
  );

  const meetingBlob = [meetingTitle, meetingSummary, ...decisions]
    .join(" \n ").toLowerCase();

  const attendeeDomains = new Set<string>();
  for (const a of attendees) {
    const match = /<([^>]+@([^>]+))>/.exec(a) ?? /([\w.+-]+@([\w.-]+))/.exec(a);
    const domain = match?.[2]?.toLowerCase();
    if (domain) attendeeDomains.add(domain.replace(/^www\./, ""));
  }

  function scoreCandidate(p: PursuitCandidate): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;
    const nameLower = p.name.toLowerCase();
    const companyLower = p.company?.toLowerCase() ?? null;

    if (companyLower && discussionCompany && discussionCompany.toLowerCase() === companyLower) {
      score += 3;
      reasons.push(`company match: ${p.company}`);
    }

    if (nameLower.length >= 3 && meetingBlob.includes(nameLower)) {
      score += 2;
      reasons.push(`pursuit name "${p.name}" mentioned`);
    }

    // Pursuit's company appears in the meeting blob. Catches cases where the
    // pursuit name is long-form ("S&P Mobility AEM Migration") but the
    // meeting says "S&P deck review". Word-boundary check avoids "S&P"
    // matching inside "responsible" — we require the company string to be
    // either at the start/end of the blob or flanked by non-alphanum chars.
    if (companyLower && companyLower.length >= 2) {
      const re = new RegExp(
        `(^|[^a-z0-9])${companyLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^a-z0-9]|$)`,
        "i"
      );
      if (re.test(meetingBlob)) {
        score += 2;
        reasons.push(`company "${p.company}" mentioned`);
      }
    }

    if (companyLower) {
      for (const d of attendeeDomains) {
        const dRoot = d.split(".")[0];
        if (dRoot && dRoot.length >= 3 &&
            (companyLower.includes(dRoot) || dRoot.includes(companyLower.replace(/\s+/g, "")))) {
          score += 2;
          reasons.push(`attendee domain ${d} matches ${p.company}`);
          break;
        }
      }
    }

    return { score, reasons };
  }

  const scored = pursuits
    .filter((p) => !linkedPursuitIds.has(p.id) && !alreadyProposedIds.has(p.id))
    .map((p) => ({ pursuit: p, ...scoreCandidate(p) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  if (scored.length === 0) return 0;

  const top = scored[0];
  const runnerUp = scored[1]?.score ?? 0;
  if (top.score >= 3 && top.score > runnerUp) {
    const { error } = await adminClient.from("pursuit_link_proposals").insert({
      user_id: userId,
      source_meeting_id: meetingId,
      suggested_pursuit_id: top.pursuit.id,
      reasoning: top.reasons.join("; "),
      confidence: 0.85,
      status: "pending",
    });
    if (error) {
      console.error("[pursuit-link] insert error (deterministic):", error);
      return 0;
    }
    return 1;
  }

  const candidatesBlock = scored.map((s, i) =>
    `[${i}] ${s.pursuit.name}${s.pursuit.company ? ` (${s.pursuit.company})` : ""}${
      s.pursuit.description ? ` — ${s.pursuit.description.substring(0, 180)}` : ""
    }\n    signals: ${s.reasons.join("; ")}`
  ).join("\n");

  const prompt = `You are deciding whether a meeting belongs to one of the user's active pursuits. A pursuit is a named thread of ongoing work (e.g. a specific sales deal, a named initiative).

MEETING: ${meetingTitle}
${discussionCompany ? `COMPANY: ${discussionCompany}\n` : ""}${meetingSummary ? `SUMMARY: ${meetingSummary.substring(0, 1500)}\n` : ""}${attendees.length > 0 ? `ATTENDEES: ${attendees.slice(0, 12).join(", ")}\n` : ""}

CANDIDATE PURSUITS (with cheap signals that suggested them):
${candidatesBlock}

Pick AT MOST ONE pursuit that this meeting clearly belongs to. Return zero if you are not confident.

STRICT CRITERIA — only return a match if ALL are true:
1. The meeting is clearly about the pursuit's named work, not just a tangential mention.
2. You can write a one-sentence reasoning a human would read and agree with.
3. Confidence is >= 0.7.

Response schema:
{
  "match": { "candidate_index": 0, "reasoning": "...", "confidence": 0.85 }
}
or
{ "match": null }

Return ONLY the JSON object, no prose.`;

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
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        temperature: 0.1,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    console.error("[pursuit-link] network error:", err);
    return 0;
  }

  if (!resp.ok) {
    console.error("[pursuit-link] Claude API error:", await resp.text());
    return 0;
  }

  const aiJson = await resp.json();
  const raw = (aiJson.content?.[0]?.text ?? "").trim();
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");

  let parsed: { match?: { candidate_index?: number; reasoning?: string; confidence?: number } | null };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("[pursuit-link] failed to parse:", err, "raw:", raw.substring(0, 300));
    return 0;
  }

  const match = parsed.match;
  if (!match || typeof match !== "object") return 0;

  const idx = match.candidate_index;
  const confidence = typeof match.confidence === "number" ? match.confidence : 0;
  const reasoning = typeof match.reasoning === "string" ? match.reasoning.trim() : "";

  if (typeof idx !== "number" || idx < 0 || idx >= scored.length) return 0;
  if (confidence < 0.7) return 0;

  const picked = scored[idx].pursuit;

  const { error } = await adminClient.from("pursuit_link_proposals").insert({
    user_id: userId,
    source_meeting_id: meetingId,
    suggested_pursuit_id: picked.id,
    reasoning: reasoning || scored[idx].reasons.join("; "),
    confidence,
    status: "pending",
  });
  if (error) {
    console.error("[pursuit-link] insert error:", error);
    return 0;
  }
  return 1;
}
