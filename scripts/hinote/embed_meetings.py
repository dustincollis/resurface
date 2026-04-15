#!/usr/bin/env python3
"""
embed_meetings.py — Chunk and embed meeting transcripts via the embed-transcript Edge Function.

Usage:
    python embed_meetings.py              # embed all unembedded meetings
    python embed_meetings.py --limit 5    # embed first 5 unembedded
    python embed_meetings.py --dry-run    # preview what would be embedded
    python embed_meetings.py --re-embed   # re-embed all meetings (including already embedded)

Environment variables (required):
    SUPABASE_URL                — e.g. https://biapwycemhtdhcpmgshp.supabase.co
    SUPABASE_SERVICE_ROLE_KEY   — service role secret
    RESURFACE_USER_ID           — your profile UUID in Resurface
"""

import argparse
import os
import sys
import time

from dotenv import load_dotenv
load_dotenv("env.local")

try:
    import requests
except ImportError:
    print("Missing dependency: requests")
    print("Run: pip install requests")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
USER_ID = os.environ.get("RESURFACE_USER_ID", "")


def check_env():
    missing = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if not USER_ID:
        missing.append("RESURFACE_USER_ID")
    if missing:
        print(f"Missing environment variables: {', '.join(missing)}")
        sys.exit(1)


def supabase_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }


def get_unembedded_meetings(re_embed: bool = False, limit: int = None) -> list:
    """Fetch meetings that need embedding."""
    url = (
        f"{SUPABASE_URL}/rest/v1/meetings"
        f"?user_id=eq.{USER_ID}"
        f"&transcript=not.is.null"
        f"&select=id,title,start_time"
        f"&order=start_time.asc"
    )
    if not re_embed:
        url += "&embedded_at=is.null"
    if limit:
        url += f"&limit={limit}"

    resp = requests.get(url, headers=supabase_headers())
    resp.raise_for_status()
    return resp.json()


def invoke_embedder(meeting_id: str) -> requests.Response:
    """Call the embed-transcript edge function."""
    url = f"{SUPABASE_URL}/functions/v1/embed-transcript"
    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    return requests.post(
        url,
        headers=headers,
        json={"meeting_id": meeting_id},
        timeout=60,
    )


def embed_all(dry_run: bool = False, limit: int = None, re_embed: bool = False):
    check_env()

    print(f"Fetching {'all' if re_embed else 'unembedded'} meetings...")
    meetings = get_unembedded_meetings(re_embed=re_embed, limit=limit)
    print(f"Found {len(meetings)} meetings to process.\n")

    if not meetings:
        print("Nothing to do.")
        return

    if dry_run:
        for i, m in enumerate(meetings):
            title = m.get("title", "Untitled")
            date = (m.get("start_time") or "")[:10]
            print(f"  [{i+1}/{len(meetings)}] {date}  {title}")
        print(f"\nDry run complete. Would embed {len(meetings)} meetings.")
        return

    embedded = 0
    skipped = 0
    errors = 0
    retry_count = 0

    i = 0
    while i < len(meetings):
        m = meetings[i]
        title = m.get("title", "Untitled")
        date = (m.get("start_time") or "")[:10]
        meeting_id = m["id"]

        print(f"  [{i+1}/{len(meetings)}] {date}  {title[:60]}", end="", flush=True)

        try:
            resp = invoke_embedder(meeting_id)
        except requests.Timeout:
            print(" ⏱ timeout, skipping")
            errors += 1
            i += 1
            continue
        except Exception as e:
            print(f" ❌ {e}")
            errors += 1
            i += 1
            continue

        if resp.status_code == 429:
            # Rate limited — exponential backoff, retry same meeting
            wait = min(60, 2 ** retry_count)
            retry_count += 1
            print(f" ⏳ rate limited, waiting {wait}s...")
            time.sleep(wait)
            continue  # retry same i

        retry_count = 0  # reset on success

        if resp.status_code >= 400:
            print(f" ❌ {resp.status_code}: {resp.text[:150]}")
            errors += 1
            i += 1
            continue

        try:
            data = resp.json()
        except Exception:
            print(f" ❌ invalid response")
            errors += 1
            i += 1
            continue

        if data.get("skipped"):
            print(f" ⏭ {data.get('reason', 'skipped')}")
            skipped += 1
        else:
            chunks = data.get("chunks_created", "?")
            tokens = data.get("total_tokens_estimated", "?")
            print(f" ✓ {chunks} chunks (~{tokens} tokens)")
            embedded += 1

        i += 1
        # Pace: 1s between calls
        time.sleep(1.0)

    print(f"\nDone. Embedded: {embedded}, Skipped: {skipped}, Errors: {errors}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Chunk and embed meeting transcripts for semantic search"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview what would be embedded without processing",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process only the first N meetings",
    )
    parser.add_argument(
        "--re-embed",
        action="store_true",
        help="Re-embed all meetings, including already embedded ones",
    )
    args = parser.parse_args()

    embed_all(dry_run=args.dry_run, limit=args.limit, re_embed=args.re_embed)
