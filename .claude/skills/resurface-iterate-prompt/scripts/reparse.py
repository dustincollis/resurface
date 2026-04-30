#!/usr/bin/env python3
"""
Re-parse one or more Resurface meetings via the ai-parse-transcript edge
function. Optionally deploys the function first. Prints a per-meeting summary
including follow-up subject + first line of body, with a delta against the
prior run on the same meeting if one exists.

Usage:
  reparse.py [--no-deploy] [--since YYYY-MM-DD] [--external-only]
             [--meeting-id UUID]... [--label LABEL]

Examples:
  reparse.py --meeting-id abc123 --meeting-id def456
  reparse.py --since 2026-04-30 --external-only --label "tighten rules"
  reparse.py --since 2026-04-30 --no-deploy
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path("/Users/dustincollis/resurface")
CONFIG_PATH = Path(
    "~/Library/Application Support/Claude/claude_desktop_config.json"
).expanduser()
HISTORY_DIR = (
    PROJECT_ROOT / ".claude" / "skills" / "resurface-iterate-prompt" / ".history"
)


# ----------------------------------------------------------------------------
# Auth + HTTP helpers
# ----------------------------------------------------------------------------

def load_creds():
    """Read Supabase URL/keys + Resurface email/password from the local Claude
    Desktop MCP config. The MCP server uses these to sign in as the user; we
    do the same. Avoids needing service-role keys for what is genuinely a
    user-scoped operation."""
    if not CONFIG_PATH.exists():
        sys.exit(
            f"Cannot find Claude Desktop config at {CONFIG_PATH}.\n"
            f"This script reads RESURFACE_EMAIL/PASSWORD from there."
        )
    cfg = json.loads(CONFIG_PATH.read_text())
    try:
        env = cfg["mcpServers"]["resurface"]["env"]
        return {
            "url": env["RESURFACE_SUPABASE_URL"],
            "anon": env["RESURFACE_SUPABASE_ANON_KEY"],
            "email": env["RESURFACE_EMAIL"],
            "password": env["RESURFACE_PASSWORD"],
        }
    except KeyError as e:
        sys.exit(f"Missing key in MCP config: {e}")


def get_jwt(creds):
    req = urllib.request.Request(
        f"{creds['url']}/auth/v1/token?grant_type=password",
        data=json.dumps({"email": creds["email"], "password": creds["password"]}).encode(),
        headers={"apikey": creds["anon"], "Content-Type": "application/json"},
        method="POST",
    )
    try:
        body = json.loads(urllib.request.urlopen(req, timeout=30).read())
    except urllib.error.HTTPError as e:
        sys.exit(f"Sign-in failed ({e.code}): {e.read()[:300].decode(errors='replace')}")
    return body["access_token"]


def supabase_get(creds, jwt, path):
    req = urllib.request.Request(
        f"{creds['url']}/rest/v1/{path}",
        headers={"Authorization": f"Bearer {jwt}", "apikey": creds["anon"]},
    )
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def edge_post(creds, jwt, fn_name, payload, timeout=600):
    req = urllib.request.Request(
        f"{creds['url']}/functions/v1/{fn_name}",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {jwt}",
            "apikey": creds["anon"],
            "Content-Type": "application/json",
        },
        method="POST",
    )
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


# ----------------------------------------------------------------------------
# Deploy
# ----------------------------------------------------------------------------

def deploy():
    """Run the project's deploy script. Critical: do NOT call `supabase
    functions deploy` directly — the wrapper passes --no-verify-jwt, which
    every function in this repo needs (auth is in-code)."""
    print("Deploying ai-parse-transcript ...")
    result = subprocess.run(
        ["npm", "run", "deploy:functions", "--", "ai-parse-transcript"],
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print("DEPLOY FAILED:")
        print(result.stderr[-1500:])
        print(result.stdout[-500:])
        sys.exit(1)
    # Look for the success marker; fall back to printing the tail.
    if "Deployed" in result.stdout or "✓" in result.stdout:
        print("✓ Deployed.\n")
    else:
        print(result.stdout[-400:])
        print()


# ----------------------------------------------------------------------------
# Meeting selection
# ----------------------------------------------------------------------------

def find_meetings(creds, jwt, args):
    if args.meeting_id:
        ids = ",".join(args.meeting_id)
        rows = supabase_get(
            creds,
            jwt,
            f"meetings?id=in.({ids})&select=id,title,attendees,start_time"
            f"&order=start_time.desc",
        )
        return rows

    if args.since:
        rows = supabase_get(
            creds,
            jwt,
            f"meetings?start_time=gte.{args.since}"
            f"&select=id,title,attendees,start_time"
            f"&order=start_time.desc&limit=200",
        )
        if args.external_only:
            rows = [m for m in rows if has_external_attendee(m)]
        return rows

    sys.exit("Need --meeting-id or --since. See --help.")


def has_external_attendee(meeting):
    """Heuristic to drop meetings that obviously have no external party.
    The parser itself is the real judge — this just trims meetings with
    only the user (or only Speaker placeholders). Lean inclusive."""
    attendees = meeting.get("attendees") or []
    if not attendees:
        return True  # unknown — let the parser decide
    real = [
        a
        for a in attendees
        if a
        and "speaker" not in a.lower()
        and a.strip().lower() not in {"dustin", "dustin collis"}
    ]
    return len(real) > 0


# ----------------------------------------------------------------------------
# Reparse + summarize
# ----------------------------------------------------------------------------

def reparse_one(creds, jwt, meeting):
    try:
        return edge_post(creds, jwt, "ai-parse-transcript", {"meeting_id": meeting["id"]})
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.read()[:300].decode(errors='replace')}"}
    except Exception as e:
        return {"error": str(e)}


def fetch_followup_details(creds, jwt, meeting_id):
    """Pull the most recent pending follow-up for this meeting, if any.
    The new data model is one shared body per row; older parses with the
    pre-migration shape would have empty draft_body and we just show what's
    there."""
    rows = supabase_get(
        creds,
        jwt,
        f"follow_ups?source_meeting_id=eq.{meeting_id}"
        f"&status=eq.pending"
        f"&select=id,draft_subject,draft_body,recipients,created_at"
        f"&order=created_at.desc&limit=1",
    )
    return rows[0] if rows else None


def first_line(s, n=120):
    if not s:
        return ""
    line = s.strip().split("\n", 1)[0].strip()
    if len(line) > n:
        return line[:n] + "..."
    return line


# ----------------------------------------------------------------------------
# History (for deltas across runs)
# ----------------------------------------------------------------------------

def save_history(label, results):
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%dT%H%M%S")
    path = HISTORY_DIR / f"{ts}.json"
    path.write_text(
        json.dumps({"timestamp": ts, "label": label, "results": results}, indent=2)
    )
    return path, ts


def load_previous_for(meeting_id, current_ts):
    """Find the most recent prior history entry that touched this meeting,
    older than the current run."""
    if not HISTORY_DIR.exists():
        return None
    for f in sorted(HISTORY_DIR.glob("*.json"), reverse=True):
        if f.stem >= current_ts:
            continue
        try:
            data = json.loads(f.read_text())
        except Exception:
            continue
        for r in data.get("results", []):
            if r.get("meeting_id") == meeting_id:
                return {"record": r, "label": data.get("label"), "ts": data.get("timestamp")}
    return None


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--meeting-id",
        action="append",
        default=[],
        help="Meeting UUID to reparse (repeatable).",
    )
    p.add_argument(
        "--since",
        help="ISO date (YYYY-MM-DD); reparse all meetings with start_time >= this.",
    )
    p.add_argument(
        "--external-only",
        action="store_true",
        help="With --since, drop meetings that obviously have no external attendee.",
    )
    p.add_argument(
        "--no-deploy",
        action="store_true",
        help="Skip the deploy step (use the currently-deployed function code).",
    )
    p.add_argument(
        "--label",
        default="(no label)",
        help="Short description of the change being tested. Saved with history.",
    )
    args = p.parse_args()

    creds = load_creds()
    jwt = get_jwt(creds)

    if not args.no_deploy:
        deploy()

    meetings = find_meetings(creds, jwt, args)
    if not meetings:
        print("No meetings matched.")
        return

    print(f"Re-parsing {len(meetings)} meeting(s)" + (f" — label: {args.label!r}\n" if args.label else "\n"))

    # Pre-allocate the run timestamp so prior-run lookups don't pick up our own
    # row when we save it later.
    run_ts = time.strftime("%Y%m%dT%H%M%S")

    results = []
    for m in meetings:
        prev = load_previous_for(m["id"], run_ts)

        result = reparse_one(creds, jwt, m)
        fu_count = result.get("follow_ups_created", 0) or 0
        props_count = result.get("proposals_created", 0) or 0
        err = result.get("error")

        fu_detail = None
        if fu_count and not err:
            fu_detail = fetch_followup_details(creds, jwt, m["id"])

        record = {
            "meeting_id": m["id"],
            "title": m.get("title"),
            "start_time": m.get("start_time"),
            "follow_ups_created": fu_count,
            "proposals_created": props_count,
            "error": err,
        }
        if fu_detail:
            record["draft_subject"] = fu_detail.get("draft_subject")
            record["draft_body_first_line"] = first_line(fu_detail.get("draft_body"))
            record["recipients"] = [
                r.get("name") for r in (fu_detail.get("recipients") or [])
            ]

        results.append(record)

        # Pretty print
        print(f"━━━ {m.get('title') or '(untitled)'} ━━━")
        print(f"  meeting_id: {m['id']}")
        if err:
            print(f"  ERROR: {err}")
        else:
            print(f"  follow_ups: {fu_count}  proposals: {props_count}")
            if fu_detail:
                names = ", ".join(record.get("recipients") or []) or "(none)"
                print(f"  to:      {names}")
                print(f"  subject: {record.get('draft_subject') or '(none)'}")
                print(f"  body[0]: {record.get('draft_body_first_line') or '(none)'}")
        if prev:
            d_fu = fu_count - (prev["record"].get("follow_ups_created") or 0)
            d_props = props_count - (prev["record"].get("proposals_created") or 0)
            sign = lambda n: f"{n:+d}"
            print(
                f"  vs prior ({prev['ts']}, {prev['label']!r}): "
                f"Δfu={sign(d_fu)} Δprops={sign(d_props)}"
            )
        print()

    # Save with the pre-allocated timestamp.
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    path = HISTORY_DIR / f"{run_ts}.json"
    path.write_text(
        json.dumps(
            {"timestamp": run_ts, "label": args.label, "results": results}, indent=2
        )
    )
    print(f"History saved: {path}")


if __name__ == "__main__":
    main()
