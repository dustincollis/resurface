#!/usr/bin/env python3
"""
sync_hinotes.py — Pull HiNotes transcripts into Resurface.

Usage:
    python sync_hinotes.py              # sync new meetings (default: last 7 days)
    python sync_hinotes.py --days 30    # sync last 30 days
    python sync_hinotes.py --backfill   # sync all, import_mode='archive'
    python sync_hinotes.py --dry-run    # preview what would sync, no writes

Environment variables (required):
    HINOTES_ACCESS_TOKEN        — from browser DevTools (AccessToken header)
    SUPABASE_URL                — e.g. https://biapwycemhtdhcpmgshp.supabase.co
    SUPABASE_SERVICE_ROLE_KEY   — service role secret
    RESURFACE_USER_ID           — your profile UUID in Resurface
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone, timedelta

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

HINOTES_BASE = "https://hinotes.hidock.com"
HINOTES_TOKEN = os.environ.get("HINOTES_ACCESS_TOKEN", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
USER_ID = os.environ.get("RESURFACE_USER_ID", "")

SOURCE = "hinotes_sync"
EXTERNAL_ID_PREFIX = "hinotes:note:"


def check_env():
    missing = []
    if not HINOTES_TOKEN:
        missing.append("HINOTES_ACCESS_TOKEN")
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if not USER_ID:
        missing.append("RESURFACE_USER_ID")
    if missing:
        print(f"Missing environment variables: {', '.join(missing)}")
        sys.exit(1)


# ---------------------------------------------------------------------------
# HiNotes API
# ---------------------------------------------------------------------------

def hinotes_headers():
    return {
        "AccessToken": HINOTES_TOKEN,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }


def hinotes_list_notes(page_index=0, page_size=20):
    """Fetch a page of notes from HiNotes."""
    resp = requests.post(
        f"{HINOTES_BASE}/v2/note/list",
        headers=hinotes_headers(),
        data={"folderId": "", "tagId": "", "pageSize": page_size, "pageIndex": page_index},
    )
    resp.raise_for_status()
    body = resp.json()
    if body.get("error") != 0:
        raise RuntimeError(f"HiNotes error: {body}")
    return body["data"]["content"]


def hinotes_get_transcription(note_id: str):
    """Fetch timestamped, speaker-diarized transcript for a note."""
    resp = requests.post(
        f"{HINOTES_BASE}/v2/note/transcription/list",
        headers=hinotes_headers(),
        data={"noteId": note_id},
    )
    resp.raise_for_status()
    body = resp.json()
    if body.get("error") != 0:
        raise RuntimeError(f"HiNotes transcription error: {body}")
    return body["data"]


def hinotes_get_detail(note_id: str):
    """Fetch full note detail including summary."""
    resp = requests.post(
        f"{HINOTES_BASE}/v2/note/detail",
        headers=hinotes_headers(),
        data={"id": note_id},
    )
    resp.raise_for_status()
    body = resp.json()
    if body.get("error") != 0:
        raise RuntimeError(f"HiNotes detail error: {body}")
    return body["data"]["note"]


def hinotes_get_speakers(note_id: str):
    """Fetch speaker list for a note."""
    resp = requests.post(
        f"{HINOTES_BASE}/v2/note/speaker/list",
        headers=hinotes_headers(),
        data={"noteId": note_id},
    )
    resp.raise_for_status()
    body = resp.json()
    if body.get("error") != 0:
        return []
    return body.get("data", []) or []


# ---------------------------------------------------------------------------
# Speaker name mapping — extract Name (Speaker N) annotations from the
# HiNotes summary and apply them to the verbatim transcript before sending
# it to the parser. This is what makes the parser able to recognize "Dustin"
# as the user instead of seeing only "Speaker 3".
# ---------------------------------------------------------------------------

# HiNotes' GPT-4.1 summarizer writes "Name (Speaker N)" — capitalized name(s)
# immediately followed by "(Speaker N)". An older summarizer used the
# inverse "Speaker N (Name)". We try both so format drift doesn't break us.
NAME_BEFORE_SPEAKER = re.compile(
    r"([A-Z][a-zA-Z'\-.]*(?:\s+[A-Z][a-zA-Z'\-.]+)*)\s*\(Speaker\s+(\d+)\)"
)
SPEAKER_BEFORE_NAME = re.compile(r"Speaker\s+(\d+)\s*\(([^)]+)\)", re.IGNORECASE)


def extract_speaker_mapping(detail) -> dict:
    """
    Build a {"Speaker 1": "Robin", "Speaker 3": "Dustin"} mapping from a
    HiNotes note detail. Only useful when HiNotes' summary actually contains
    Speaker N annotations — most don't, so this usually returns {}.
    """
    if not detail:
        return {}
    haystack = json.dumps(detail) if not isinstance(detail, str) else detail
    mapping = {}

    for match in NAME_BEFORE_SPEAKER.finditer(haystack):
        name = match.group(1).strip()
        num = match.group(2)
        key = f"Speaker {num}"
        if key not in mapping:
            mapping[key] = name

    for match in SPEAKER_BEFORE_NAME.finditer(haystack):
        num = match.group(1)
        name = match.group(2).strip()
        if name.lower() == "mentioned":
            continue
        key = f"Speaker {num}"
        if key not in mapping:
            mapping[key] = name

    return mapping


# Match the "Attendee" line in HiNotes' markdown/html summary, e.g.:
#   - **Attendee**: Dustin, Holly, Tomas, Vicky, Monica
#   <strong>Attendee</strong>: Dustin, Holly, ...
ATTENDEE_LINE = re.compile(
    r"(?:\*\*|<strong>)?\s*Attendee\s*(?:\*\*|</strong>)?\s*[:：]\s*([^\n<]+)",
    re.IGNORECASE,
)
# Catch-all phrases we should NOT treat as attendees
ATTENDEE_NOISE = re.compile(
    r"^(other team members.*|.*representatives|.*team|et al\.?|and\s+others?)$",
    re.IGNORECASE,
)


def extract_attendees_from_summary(detail) -> list:
    """
    Pull a flat list of attendee names from a HiNotes note detail. HiNotes'
    GPT-4.1 summarizer writes a comma-separated list under "Attendee:" in
    both the markdown and html fields. We search both because either may be
    populated.

    Returns e.g. ["Dustin", "Holly", "Tomas", "Vicky", "Monica"].
    """
    if not detail or not isinstance(detail, dict):
        return []
    sources = []
    for field in ("markdown", "html", "summary"):
        val = detail.get(field)
        if isinstance(val, str) and val:
            sources.append(val)
    seen = set()
    out = []
    for src in sources:
        m = ATTENDEE_LINE.search(src)
        if not m:
            continue
        raw = m.group(1).strip()
        for part in re.split(r",|\sand\s", raw):
            cleaned = re.sub(r"\([^)]*\)", "", part)
            cleaned = re.sub(r"\s+", " ", cleaned).strip()
            if not cleaned or cleaned.lower() in seen:
                continue
            if ATTENDEE_NOISE.match(cleaned):
                continue
            seen.add(cleaned.lower())
            out.append(cleaned)
        if out:
            break  # use the first source that yielded anything
    return out


# ---------------------------------------------------------------------------
# Transcript formatting — matches hinotes-fetch edge function output
# ---------------------------------------------------------------------------

def format_timestamp(ms: int) -> str:
    """Convert milliseconds to [mm:ss] format."""
    total_seconds = ms // 1000
    minutes = total_seconds // 60
    seconds = total_seconds % 60
    return f"[{minutes:02d}:{seconds:02d}]"


def format_transcript(segments: list, speaker_mapping: dict = None) -> str:
    """Format transcript segments as [mm:ss] <Name>: text lines.

    If speaker_mapping is provided, generic labels like "Speaker 1" are
    replaced with their identified names. Speakers without a mapping
    keep their original label.
    """
    if speaker_mapping is None:
        speaker_mapping = {}
    lines = []
    for seg in segments:
        ts = format_timestamp(seg.get("beginTime", 0))
        raw_speaker = seg.get("speaker") or "Unknown"
        speaker = speaker_mapping.get(raw_speaker, raw_speaker)
        sentence = (seg.get("sentence") or "").strip()
        if sentence:
            lines.append(f"{ts} {speaker}: {sentence}")
    return "\n".join(lines)


def extract_attendees(segments: list, speakers_data: list, speaker_mapping: dict = None) -> list:
    """Extract attendees, preferring identified names over generic labels."""
    if speaker_mapping is None:
        speaker_mapping = {}
    attendees = set()
    for seg in segments:
        raw = seg.get("speaker")
        if raw:
            attendees.add(speaker_mapping.get(raw, raw))
    if speakers_data:
        for sd in speakers_data:
            name = sd.get("name") or sd.get("speaker")
            if name:
                attendees.add(speaker_mapping.get(name, name))
    return sorted(attendees)


# ---------------------------------------------------------------------------
# Supabase / Resurface
# ---------------------------------------------------------------------------

def supabase_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def get_existing_external_ids() -> set:
    """Fetch all external_source_ids for this user with hinotes prefix."""
    url = (
        f"{SUPABASE_URL}/rest/v1/meetings"
        f"?user_id=eq.{USER_ID}"
        f"&source=eq.{SOURCE}"
        f"&select=external_source_id"
        f"&external_source_id=not.is.null"
    )
    resp = requests.get(url, headers=supabase_headers())
    resp.raise_for_status()
    return {row["external_source_id"] for row in resp.json()}


def insert_meeting(row: dict) -> str:
    """Insert a meeting row into Resurface. Returns the new meeting UUID."""
    url = f"{SUPABASE_URL}/rest/v1/meetings"
    resp = requests.post(url, headers=supabase_headers(), json=row)
    if resp.status_code == 409:
        print(f"    Duplicate (already synced), skipping.")
        return None
    resp.raise_for_status()
    data = resp.json()
    return data[0]["id"] if data else None


def invoke_parser(meeting_id: str, transcript: str):
    """Call the ai-parse-transcript edge function."""
    url = f"{SUPABASE_URL}/functions/v1/ai-parse-transcript"
    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    resp = requests.post(
        url,
        headers=headers,
        json={"meeting_id": meeting_id, "transcript": transcript},
    )
    if resp.status_code >= 400:
        print(f"    Parser error ({resp.status_code}): {resp.text[:300]}")
        return False
    return True


# ---------------------------------------------------------------------------
# Sync logic
# ---------------------------------------------------------------------------

def sync(days: int = 7, backfill: bool = False, dry_run: bool = False):
    check_env()

    cutoff_ms = None
    if not backfill:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        cutoff_ms = int(cutoff.timestamp() * 1000)

    import_mode = "archive" if backfill else "active"

    print(f"Mode: {'backfill (archive)' if backfill else f'last {days} days (active)'}")
    if dry_run:
        print("DRY RUN — no writes will be made.\n")

    # Fetch existing synced IDs to skip already-synced notes
    if not dry_run:
        existing = get_existing_external_ids()
        print(f"Already synced: {len(existing)} meetings\n")
    else:
        existing = set()

    # Paginate through HiNotes note list
    page = 0
    synced = 0
    skipped = 0
    errors = 0

    while True:
        notes = hinotes_list_notes(page_index=page, page_size=20)
        if not notes:
            break

        for note in notes:
            note_id = note["id"]
            title = note.get("title") or "Untitled"
            create_time = note.get("createTime", 0)
            state = note.get("state", "")

            # Skip notes that are not fully saved/transcribed
            if state not in ("saved", "transcribed"):
                continue

            # Stop pagination if we've gone past the cutoff
            if cutoff_ms and create_time < cutoff_ms:
                # Notes are ordered newest-first, so we can stop
                notes = []  # break outer loop
                break

            external_id = f"{EXTERNAL_ID_PREFIX}{note_id}"

            if external_id in existing:
                skipped += 1
                continue

            ts = datetime.fromtimestamp(create_time / 1000, tz=timezone.utc)
            print(f"  [{ts.strftime('%Y-%m-%d %H:%M')}] {title}")

            if dry_run:
                synced += 1
                continue

            # Fetch transcript and speakers
            try:
                segments = hinotes_get_transcription(note_id)
                speakers_data = hinotes_get_speakers(note_id)
            except Exception as e:
                print(f"    Error fetching transcript: {e}")
                errors += 1
                continue

            # Best-effort: fetch the note detail for two purposes:
            #   1. Speaker mapping (rare — only when HiNotes diarized AND
            #      summarized with Speaker N annotations).
            #   2. Attendee list (common — HiNotes' GPT-4.1 summarizer puts
            #      a flat name list under "Attendee:" in the markdown/html).
            # The attendee list is what makes the parser able to attribute
            # statements when transcripts have no speaker labels at all.
            speaker_mapping = {}
            summary_attendees: list = []
            try:
                detail = hinotes_get_detail(note_id)
                speaker_mapping = extract_speaker_mapping(detail)
                summary_attendees = extract_attendees_from_summary(detail)
                if speaker_mapping:
                    print(f"    Speakers identified: {len(speaker_mapping)} ({', '.join(f'{k}={v}' for k, v in speaker_mapping.items())})")
                if summary_attendees:
                    print(f"    Attendees from summary: {', '.join(summary_attendees)}")
            except Exception as e:
                print(f"    Could not fetch note detail: {e}")

            if not segments:
                print(f"    No transcript segments, skipping.")
                skipped += 1
                continue

            transcript = format_transcript(segments, speaker_mapping)
            # Prefer the summary's attendee list (real names) over the
            # generic speaker labels from segments.
            if summary_attendees:
                attendees = summary_attendees
            else:
                attendees = extract_attendees(segments, speakers_data, speaker_mapping)

            # Calculate end_time from last segment
            last_end_ms = max(s.get("endTime", 0) for s in segments)
            duration_ms = note.get("duration", 0) or last_end_ms
            end_time = None
            if duration_ms > 0:
                end_time = (ts + timedelta(milliseconds=duration_ms)).isoformat()

            row = {
                "user_id": USER_ID,
                "title": title,
                "start_time": ts.isoformat(),
                "end_time": end_time,
                "attendees": attendees,
                "transcript": transcript,
                "source": SOURCE,
                "import_mode": import_mode,
                "external_source_id": external_id,
            }

            try:
                meeting_id = insert_meeting(row)
            except requests.HTTPError as e:
                # PostgREST returns a JSON body with code/details/hint
                body = e.response.text if e.response is not None else ""
                status = e.response.status_code if e.response is not None else "?"
                print(f"    Insert error {status}: {body}")
                errors += 1
                continue
            except Exception as e:
                print(f"    Insert error: {e}")
                errors += 1
                continue

            if not meeting_id:
                skipped += 1
                continue

            print(f"    Inserted: {meeting_id}")

            # Invoke parser
            ok = invoke_parser(meeting_id, transcript)
            if ok:
                print(f"    Parsed successfully.")
                synced += 1
            else:
                errors += 1

            # Brief pause to avoid hammering APIs
            time.sleep(0.5)

        # If we broke out of the inner loop due to cutoff
        if cutoff_ms and notes and notes[-1].get("createTime", 0) < cutoff_ms:
            break

        page += 1

    print(f"\nDone. Synced: {synced}, Skipped: {skipped}, Errors: {errors}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sync HiNotes transcripts to Resurface")
    parser.add_argument("--days", type=int, default=7, help="Sync meetings from the last N days (default: 7)")
    parser.add_argument("--backfill", action="store_true", help="Sync all meetings as archive (no proposals)")
    parser.add_argument("--dry-run", action="store_true", help="Preview what would sync without writing")
    args = parser.parse_args()

    sync(days=args.days, backfill=args.backfill, dry_run=args.dry_run)
