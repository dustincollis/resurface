# HiNotes Probe: Find Out What's Transcribed

## Goal
Run a dry-run of the recovered HiNotes sync script to see how many of the 973 recordings have transcripts ready, and what metadata is available for matching to calendar events.

## Setup (one-time)

### 1. Get your HiNotes AccessToken
1. Open https://hinotes.hidock.com in your browser
2. Open DevTools → Network tab
3. Click around to trigger any API call
4. Find a request to `hidock.com` and copy the `AccessToken` header value
5. This token expires — grab it right before you run the script

### 2. Get your Resurface user ID
You need the UUID from the `profiles` table. This is the `RESURFACE_DEFAULT_USER_ID` you already have set as a Supabase Edge Function secret.

### 3. Set environment variables
Create or edit `scripts/hinote/env.local`:
```
HINOTES_ACCESS_TOKEN=<paste token here>
SUPABASE_URL=https://biapwycemhtdhcpmgshp.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your service role key>
RESURFACE_USER_ID=<your profile UUID>
```

### 4. Install dependency (if needed)
```bash
pip install python-dotenv requests
```

## Run the probe

```bash
cd /Users/dustincollis/resurface
python scripts/hinote/sync_hinotes.py --backfill --dry-run
```

This will:
- Paginate through ALL recordings via `/v2/note/list`
- For each, fetch transcript via `/v2/note/transcription/list`
- Print what it finds WITHOUT writing anything to the database
- Show you which ones have transcripts and which don't

## What to look for

1. **Total count** — does it see all 973?
2. **Which have transcripts** — the script logs per-recording; look for empty transcript vs. populated
3. **Timestamps** — each recording has `createTime` (epoch ms). This is what we'll use to match to the 256 Outlook calendar events
4. **Speaker names** — does the speaker mapping regex find real names?

## What happens next

Bring the output back to Claude Code. We'll use it to:
- Determine how many are ready to load now vs. pending transcription
- Build the matching logic between HiNotes recordings and Outlook calendar events
- Plan the ingest pipeline phases

## File locations
- **Script**: `scripts/hinote/sync_hinotes.py` (recovered from git, not committed)
- **Calendar data**: `docs/past-meetings.json` (256 Outlook events, Feb 3 – Apr 10, 2026)
