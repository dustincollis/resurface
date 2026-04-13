#!/usr/bin/env python3
"""
compare-opus-vs-sonnet.py — Run the same parsing prompt through both
Claude Opus 4.6 and Claude Sonnet 4.6 for each Jamie-imported meeting,
save outputs, and generate a comparison report.

Uses the ai-parse-preview Edge Function so no Anthropic key is needed locally.

Usage:
    SB_SERVICE_ROLE_KEY=... python3 scripts/compare-opus-vs-sonnet.py

Outputs land in /tmp/opus-vs-sonnet/:
  - {meeting_id}_opus.json      — full Opus 4.6 payload
  - {meeting_id}_sonnet.json    — full Sonnet 4.6 payload
  - {meeting_id}_diff.txt       — side-by-side per-meeting diff
  - comparison.md               — top-level rollup
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path

SUPABASE_URL = "https://biapwycemhtdhcpmgshp.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")
OUT_DIR = Path("/tmp/opus-vs-sonnet")
PREVIEW_URL = f"{SUPABASE_URL}/functions/v1/ai-parse-preview"

MODELS = {
    "opus": "claude-opus-4-6",
    "sonnet": "claude-sonnet-4-6",
}

# Per-1M-token rates (approx)
RATES = {
    "claude-opus-4-6": {"in": 15.0, "out": 75.0},
    "claude-sonnet-4-6": {"in": 3.0, "out": 15.0},
}


def supabase_get(path, params=None):
    qs = urllib.parse.urlencode(params or {})
    url = f"{SUPABASE_URL}/rest/v1/{path}?{qs}" if qs else f"{SUPABASE_URL}/rest/v1/{path}"
    req = urllib.request.Request(url, headers={
        "apikey": SB_KEY,
        "Authorization": f"Bearer {SB_KEY}",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def call_preview(meeting_id, model):
    body = json.dumps({"meeting_id": meeting_id, "model": model}).encode()
    req = urllib.request.Request(PREVIEW_URL, data=body, headers={
        "Authorization": f"Bearer {SB_KEY}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())


def summarize(data):
    return {
        "participants": len(data.get("participants", [])),
        "decisions": len(data.get("decisions", [])),
        "open_questions": len(data.get("open_questions", [])),
        "commitments": len(data.get("commitments", [])),
        "topics": len(data.get("topics", [])),
        "ideas": len(data.get("ideas", [])),
        "summary_length": len(data.get("summary", "")),
        "ideas_list": [i.get("title", "") for i in data.get("ideas", [])],
        "topics_list": data.get("topics", []),
        "commitments_list": [c.get("title", "") for c in data.get("commitments", [])],
    }


def main():
    if not SB_KEY:
        print("ERROR: Set SB_SERVICE_ROLE_KEY environment variable")
        sys.exit(1)

    OUT_DIR.mkdir(exist_ok=True)
    print(f"Output dir: {OUT_DIR}\n")

    meetings = supabase_get("meetings", {
        "select": "id,title,start_time,attendees,transcript",
        "source": "eq.jamie_webhook",
        "order": "start_time.asc",
    })
    print(f"Processing {len(meetings)} Jamie meetings...\n")

    rollup = []
    total_cost = 0.0

    for i, meeting in enumerate(meetings, 1):
        mid = meeting["id"]
        title = (meeting.get("title") or "Untitled")[:60]
        chars = len(meeting.get("transcript") or "")
        print(f"[{i}/{len(meetings)}] {title} ({chars:,} chars)")

        results = {}
        for label, model_id in MODELS.items():
            print(f"  Running {label}...", end=" ", flush=True)
            start = time.time()
            try:
                resp = call_preview(mid, model_id)
                if "error" in resp:
                    print(f"FAIL: {resp.get('error')}")
                    results[label] = {"error": resp.get("error")}
                    continue
                data = resp["result"]
                usage = resp.get("usage", {})
                elapsed = time.time() - start
                results[label] = {"data": data, "usage": usage, "elapsed": elapsed}

                r = RATES[model_id]
                cost = (usage.get("input_tokens", 0) * r["in"] + usage.get("output_tokens", 0) * r["out"]) / 1_000_000
                total_cost += cost
                print(f"done ({elapsed:.0f}s, ~${cost:.3f})")

                (OUT_DIR / f"{mid}_{label}.json").write_text(json.dumps(data, indent=2))
            except Exception as e:
                print(f"FAIL: {e}")
                results[label] = {"error": str(e)}
            time.sleep(1)

        # Per-meeting diff
        if "data" in results.get("opus", {}) and "data" in results.get("sonnet", {}):
            opus_s = summarize(results["opus"]["data"])
            sonnet_s = summarize(results["sonnet"]["data"])
            diff_lines = [
                f"Meeting: {meeting['title']}",
                f"ID: {mid}",
                f"Transcript: {chars:,} chars",
                "",
                f"{'Metric':<20} {'Opus':>6}  {'Sonnet':>6}  Delta",
                "-" * 50,
                f"{'Participants':<20} {opus_s['participants']:>6}  {sonnet_s['participants']:>6}  {opus_s['participants'] - sonnet_s['participants']:+d}",
                f"{'Decisions':<20} {opus_s['decisions']:>6}  {sonnet_s['decisions']:>6}  {opus_s['decisions'] - sonnet_s['decisions']:+d}",
                f"{'Open questions':<20} {opus_s['open_questions']:>6}  {sonnet_s['open_questions']:>6}  {opus_s['open_questions'] - sonnet_s['open_questions']:+d}",
                f"{'Commitments':<20} {opus_s['commitments']:>6}  {sonnet_s['commitments']:>6}  {opus_s['commitments'] - sonnet_s['commitments']:+d}",
                f"{'Topics':<20} {opus_s['topics']:>6}  {sonnet_s['topics']:>6}  {opus_s['topics'] - sonnet_s['topics']:+d}",
                f"{'Ideas':<20} {opus_s['ideas']:>6}  {sonnet_s['ideas']:>6}  {opus_s['ideas'] - sonnet_s['ideas']:+d}",
                f"{'Summary (chars)':<20} {opus_s['summary_length']:>6}  {sonnet_s['summary_length']:>6}  {opus_s['summary_length'] - sonnet_s['summary_length']:+d}",
                "",
                "OPUS IDEAS:",
                *[f"  - {t}" for t in opus_s["ideas_list"]],
                "",
                "SONNET IDEAS:",
                *[f"  - {t}" for t in sonnet_s["ideas_list"]],
                "",
                "OPUS TOPICS: " + " | ".join(opus_s["topics_list"]),
                "SONNET TOPICS: " + " | ".join(sonnet_s["topics_list"]),
                "",
                "OPUS COMMITMENTS:",
                *[f"  - {t}" for t in opus_s["commitments_list"]],
                "",
                "SONNET COMMITMENTS:",
                *[f"  - {t}" for t in sonnet_s["commitments_list"]],
            ]
            (OUT_DIR / f"{mid}_diff.txt").write_text("\n".join(diff_lines))
            rollup.append({
                "meeting": meeting["title"],
                "id": mid,
                "opus": opus_s,
                "sonnet": sonnet_s,
            })

    # Top-level rollup
    md = ["# Opus 4.6 vs Sonnet 4.6 — Jamie Meeting Parsing Comparison", ""]
    md.append(f"Processed {len(rollup)} meetings. Total API cost: ~${total_cost:.2f}")
    md.append("")
    md.append("| Meeting | Ideas (O/S) | Commits (O/S) | Topics (O/S) | Participants (O/S) |")
    md.append("|---------|-------------|---------------|--------------|-------------------|")
    for r in rollup:
        md.append(
            f"| {r['meeting'][:50]} | {r['opus']['ideas']}/{r['sonnet']['ideas']} | "
            f"{r['opus']['commitments']}/{r['sonnet']['commitments']} | "
            f"{r['opus']['topics']}/{r['sonnet']['topics']} | "
            f"{r['opus']['participants']}/{r['sonnet']['participants']} |"
        )

    if rollup:
        totals_o = {k: sum(r["opus"][k] for r in rollup) for k in ["ideas", "commitments", "topics", "participants", "decisions", "open_questions"]}
        totals_s = {k: sum(r["sonnet"][k] for r in rollup) for k in ["ideas", "commitments", "topics", "participants", "decisions", "open_questions"]}
        md.append("")
        md.append("## Totals")
        md.append(f"- Ideas: **Opus {totals_o['ideas']}** vs **Sonnet {totals_s['ideas']}**")
        md.append(f"- Commitments: **Opus {totals_o['commitments']}** vs **Sonnet {totals_s['commitments']}**")
        md.append(f"- Decisions: **Opus {totals_o['decisions']}** vs **Sonnet {totals_s['decisions']}**")
        md.append(f"- Open questions: **Opus {totals_o['open_questions']}** vs **Sonnet {totals_s['open_questions']}**")
        md.append(f"- Topics: **Opus {totals_o['topics']}** vs **Sonnet {totals_s['topics']}**")
        md.append(f"- Participants: **Opus {totals_o['participants']}** vs **Sonnet {totals_s['participants']}**")

    (OUT_DIR / "comparison.md").write_text("\n".join(md))
    print(f"\nDone. Total cost: ~${total_cost:.2f}")
    print(f"See {OUT_DIR}/comparison.md")


if __name__ == "__main__":
    main()
