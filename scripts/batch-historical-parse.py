#!/usr/bin/env python3
"""
batch-historical-parse.py — Run the historical parser across all unprocessed meetings.

Usage:
    python3 batch-historical-parse.py                  # run all unprocessed
    python3 batch-historical-parse.py --limit 10       # process 10 then stop
    python3 batch-historical-parse.py --delay 3        # 3 seconds between calls
    python3 batch-historical-parse.py --dry-run        # preview what would run

Environment variables:
    SB_SERVICE_ROLE_KEY   — Supabase service role JWT
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error

SUPABASE_URL = "https://biapwycemhtdhcpmgshp.supabase.co"
SERVICE_ROLE_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")

PARSE_URL = f"{SUPABASE_URL}/functions/v1/ai-parse-transcript"
REST_URL = f"{SUPABASE_URL}/rest/v1"


def get_unprocessed_meetings(limit=None):
    """Fetch meetings that have transcripts but haven't been parsed yet."""
    params = urllib.parse.urlencode({
        "select": "id,title,start_time,source,import_mode",
        "transcript": "not.is.null",
        "processed_at": "is.null",
        "order": "start_time.asc",
        "limit": str(limit * 2) if limit else "2000",
    })
    url = f"{REST_URL}/meetings?{params}"
    req = urllib.request.Request(url, headers={
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    })
    with urllib.request.urlopen(req) as resp:
        meetings = json.loads(resp.read())

    if limit:
        meetings = meetings[:limit]
    return meetings


def parse_meeting(meeting_id):
    """Call the historical parser for a single meeting."""
    body = json.dumps({"meeting_id": meeting_id, "mode": "historical"}).encode()
    req = urllib.request.Request(PARSE_URL, data=body, headers={
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        try:
            return e.code, json.loads(error_body)
        except:
            return e.code, {"error": error_body[:200]}


def main():
    parser = argparse.ArgumentParser(description="Batch historical parse of meetings")
    parser.add_argument("--limit", type=int, default=None, help="Max meetings to process")
    parser.add_argument("--delay", type=float, default=2.0, help="Seconds between API calls (default: 2)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without parsing")
    args = parser.parse_args()

    if not SERVICE_ROLE_KEY:
        print("ERROR: Set SB_SERVICE_ROLE_KEY environment variable")
        print('  export SB_SERVICE_ROLE_KEY="eyJ..."')
        sys.exit(1)

    print("Fetching unprocessed meetings...")
    meetings = get_unprocessed_meetings(limit=args.limit)
    total = len(meetings)
    print(f"Found {total} meetings to process\n")

    if total == 0:
        print("Nothing to do.")
        return

    if args.dry_run:
        print("DRY RUN — would process:")
        for i, m in enumerate(meetings, 1):
            date = (m.get("start_time") or "no date")[:10]
            title = (m.get("title") or "Untitled")[:60]
            print(f"  {i:3d}. [{date}] {title}")
        return

    successes = 0
    failures = 0
    total_ideas = 0
    total_commitments = 0
    total_participants = 0

    for i, m in enumerate(meetings, 1):
        meeting_id = m["id"]
        date = (m.get("start_time") or "no date")[:10]
        title = (m.get("title") or "Untitled")[:55]

        print(f"[{i:3d}/{total}] {date} | {title}...", end=" ", flush=True)

        try:
            start = time.time()
            status, result = parse_meeting(meeting_id)
            elapsed = time.time() - start

            if status == 200:
                ideas = result.get("ideas_created", 0)
                commits = result.get("commitments_created", 0)
                parts = result.get("participants_linked", 0)
                topics = len(result.get("topics", []))

                total_ideas += ideas
                total_commitments += commits
                total_participants += parts
                successes += 1

                print(f"OK ({elapsed:.1f}s) — {ideas} ideas, {commits} commitments, {parts} people, {topics} topics")
            else:
                failures += 1
                error = result.get("error", "unknown")
                print(f"FAIL ({status}: {error})")

        except TimeoutError:
            failures += 1
            print("TIMEOUT (>120s)")
        except Exception as e:
            failures += 1
            print(f"ERROR ({e})")

        # Throttle between calls
        if i < total:
            time.sleep(args.delay)

    print(f"\n{'='*60}")
    print(f"Done. {successes} succeeded, {failures} failed out of {total}")
    print(f"Totals: {total_ideas} ideas, {total_commitments} commitments, {total_participants} participants linked")
    if failures > 0:
        print(f"\nRe-run to retry failures (processed_at stays NULL on failed meetings)")


if __name__ == "__main__":
    main()
