#!/usr/bin/env python3
"""
batch-triage-ideas.py — Score all un-triaged ideas as high/medium/low signal.

Usage:
    python3 scripts/batch-triage-ideas.py                  # triage all
    python3 scripts/batch-triage-ideas.py --batch-size 50  # per-batch size
    python3 scripts/batch-triage-ideas.py --delay 2        # seconds between calls

Environment variables:
    SB_SERVICE_ROLE_KEY   — Supabase service role JWT
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error

SUPABASE_URL = "https://biapwycemhtdhcpmgshp.supabase.co"
SERVICE_ROLE_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")
TRIAGE_URL = f"{SUPABASE_URL}/functions/v1/ai-triage-ideas"


def call_triage(batch_size):
    body = json.dumps({"batch_size": batch_size}).encode()
    req = urllib.request.Request(TRIAGE_URL, data=body, headers={
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--delay", type=float, default=2.0)
    args = parser.parse_args()

    if not SERVICE_ROLE_KEY:
        print("ERROR: Set SB_SERVICE_ROLE_KEY environment variable")
        sys.exit(1)

    total_high = 0
    total_medium = 0
    total_low = 0
    total_processed = 0
    batch_num = 0

    print(f"Starting triage with batch size {args.batch_size}...\n")

    while True:
        batch_num += 1
        start = time.time()
        status, result = call_triage(args.batch_size)
        elapsed = time.time() - start

        if status != 200:
            print(f"[batch {batch_num}] FAIL ({status}): {result.get('error', 'unknown')}")
            # Don't keep hammering on errors
            break

        if result.get("done") or result.get("processed", 0) == 0:
            print(f"\n✓ Triage complete.")
            break

        processed = result.get("processed", 0)
        high = result.get("high", 0)
        medium = result.get("medium", 0)
        low = result.get("low", 0)
        remaining = result.get("remaining", 0)

        total_high += high
        total_medium += medium
        total_low += low
        total_processed += processed

        print(f"[batch {batch_num}] {elapsed:.1f}s  processed={processed}  high={high}  med={medium}  low={low}  remaining={remaining}")

        if remaining == 0:
            print(f"\n✓ Triage complete.")
            break

        time.sleep(args.delay)

    print(f"\n{'='*60}")
    print(f"Total triaged: {total_processed}")
    print(f"  High:   {total_high}  ({100*total_high//max(1,total_processed)}%)")
    print(f"  Medium: {total_medium}  ({100*total_medium//max(1,total_processed)}%)")
    print(f"  Low:    {total_low}  ({100*total_low//max(1,total_processed)}%)  [auto-dismissed]")


if __name__ == "__main__":
    main()
