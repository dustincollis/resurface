#!/usr/bin/env python3
"""
cluster-ideas.py — Group similar ideas across meetings using Claude.

Fetches all ideas, sends them to Claude for semantic clustering, then
updates cluster_id and cluster_label on each idea.

Usage:
    python3 scripts/cluster-ideas.py                  # run clustering
    python3 scripts/cluster-ideas.py --dry-run        # preview without writing

Environment variables:
    SB_SERVICE_ROLE_KEY   — Supabase service role JWT
    ANTHROPIC_API_KEY     — Claude API key (reads from Supabase secrets if not set)
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
import uuid

SUPABASE_URL = "https://biapwycemhtdhcpmgshp.supabase.co"
SERVICE_ROLE_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

REST_URL = f"{SUPABASE_URL}/rest/v1"


def supabase_get(table, params=None):
    qs = urllib.parse.urlencode(params or {})
    url = f"{REST_URL}/{table}?{qs}" if qs else f"{REST_URL}/{table}"
    req = urllib.request.Request(url, headers={
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def supabase_patch(table, id_val, data):
    url = f"{REST_URL}/{table}?id=eq.{id_val}"
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method="PATCH", headers={
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    })
    with urllib.request.urlopen(req) as resp:
        return resp.status


def call_claude(prompt):
    body = json.dumps({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 8192,
        "temperature": 0.2,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, headers={
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
    })
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read())
    raw = result["content"][0]["text"].strip()
    if raw.startswith("```"):
        raw = raw.replace("```json", "").replace("```", "").strip()
    return json.loads(raw)


def main():
    parser = argparse.ArgumentParser(description="Cluster ideas using Claude")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()

    if not SERVICE_ROLE_KEY:
        print("ERROR: Set SB_SERVICE_ROLE_KEY environment variable")
        sys.exit(1)
    if not ANTHROPIC_KEY:
        print("ERROR: Set ANTHROPIC_API_KEY environment variable")
        sys.exit(1)

    print("Fetching ideas...")
    ideas = supabase_get("ideas", {
        "select": "id,title,description,company_name,category,originated_by",
        "order": "created_at.asc",
    })
    print(f"Found {len(ideas)} ideas\n")

    if len(ideas) < 3:
        print("Not enough ideas to cluster.")
        return

    # Build the prompt
    idea_lines = []
    for i, idea in enumerate(ideas):
        co = idea.get("company_name") or "general"
        cat = idea.get("category") or "other"
        desc = idea.get("description") or ""
        idea_lines.append(f'{i}: [{cat}] ({co}) {idea["title"]} — {desc[:120]}')

    ideas_text = "\n".join(idea_lines)

    prompt = f"""You are analyzing a corpus of {len(ideas)} strategic ideas extracted from 6+ months of sales meetings for a senior GTM leader at EPAM (a technology consultancy). Your job is to identify natural clusters — groups of ideas that address the same theme, strategy, or opportunity, even if they appeared in different meetings about different clients.

Here are the ideas (format: index: [category] (company) title — description):

{ideas_text}

Group these into clusters. Rules:
- Each cluster should have 2+ ideas that share a common strategic theme
- Ideas that don't fit any cluster can go in a "Unclustered" group
- Aim for 8-20 clusters (not too granular, not too broad)
- Cluster labels should be concise (3-8 words) and action-oriented where possible
- The same idea can only appear in one cluster
- Focus on strategic similarity, not just same company or same category

Return ONLY valid JSON (no markdown, no code fences):
{{
  "clusters": [
    {{
      "label": "string — concise cluster name",
      "description": "string — 1 sentence explaining what unifies these ideas",
      "idea_indices": [0, 3, 7]
    }}
  ]
}}"""

    print("Sending to Claude for clustering...")
    result = call_claude(prompt)
    clusters = result.get("clusters", [])
    print(f"Got {len(clusters)} clusters\n")

    # Assign cluster IDs
    assignments = {}  # idea_index -> (cluster_id, cluster_label)
    for cluster in clusters:
        label = cluster["label"]
        desc = cluster.get("description", "")
        cluster_id = str(uuid.uuid4())
        indices = cluster.get("idea_indices", [])
        print(f"  [{len(indices):2d} ideas] {label}")
        if desc:
            print(f"           {desc[:80]}")
        for idx in indices:
            if 0 <= idx < len(ideas):
                assignments[idx] = (cluster_id, label)

    unclustered = len(ideas) - len(assignments)
    print(f"\n{len(assignments)} ideas clustered, {unclustered} unclustered")

    if args.dry_run:
        print("\nDRY RUN — no changes written.")
        return

    # Write cluster assignments
    print("\nWriting cluster assignments...")
    updated = 0
    for idx, (cluster_id, label) in assignments.items():
        idea = ideas[idx]
        try:
            supabase_patch("ideas", idea["id"], {
                "cluster_id": cluster_id,
                "cluster_label": label,
            })
            updated += 1
        except Exception as e:
            print(f"  FAIL on idea {idx}: {e}")

    # Clear cluster on unclustered ideas (in case of re-run)
    for idx, idea in enumerate(ideas):
        if idx not in assignments and (idea.get("cluster_id") or idea.get("cluster_label")):
            try:
                supabase_patch("ideas", idea["id"], {
                    "cluster_id": None,
                    "cluster_label": None,
                })
            except:
                pass

    print(f"Done. Updated {updated} ideas with cluster assignments.")


if __name__ == "__main__":
    main()
