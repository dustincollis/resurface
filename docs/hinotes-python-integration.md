# HiNotes Python Sync — Resurface integration brief

Context: a separate Python script (`sync_hinotes.py`) running on a local Mac will pull HiNotes meetings via the HiNotes API and write them into the Resurface Supabase project. This document answers integration questions and recommends the cleanest architecture.

## Important framing

There is **no "ingestion pipeline reading from a staging table"** in Resurface today. The architecture is direct-invocation: the frontend writes a row to `meetings`, sets `transcript`, then immediately invokes the `ai-parse-transcript` edge function. No polling, no queue, no background workers, no triggers.

The Python script should plug into that same direct-call flow.

---

## Answers

### 1. Project URL and schema

- URL: `https://biapwycemhtdhcpmgshp.supabase.co`
- Project ref: `biapwycemhtdhcpmgshp`
- Schema: `public` (every table lives in the default schema)

### 2. Input table and columns

The ingestion target is `public.meetings`. Relevant columns:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` default |
| `user_id` | uuid fk → profiles | required, RLS scoped on this |
| `title` | text | meeting title; AI auto-fills if it looks like `Untitled` or a filename pattern |
| `start_time` | timestamptz | when the conversation happened |
| `end_time` | timestamptz | optional |
| `attendees` | text[] | optional, used as parser context |
| `transcript` | text | **the raw text the parser reads** |
| `transcript_summary` | text | AI-generated, written by the parser |
| `extracted_decisions` | jsonb | AI-written |
| `extracted_open_questions` | jsonb | AI-written |
| `extracted_action_items` | jsonb | empty array — superseded by the `proposals` table |
| `source` | text | free-form provenance string (`'manual'`, `'transcript_upload'`, `'ics'`) |
| `import_mode` | text | **`'active'` or `'archive'`**. Active = create proposals; Archive = summarize only, no proposals |
| `processed_at` | timestamptz | parser sets this on success |
| `ics_uid` | text | reserved for calendar ICS dedup — do NOT repurpose |

After parsing, action items go to a separate `proposals` table. The Python script does not need to touch it; the edge function writes proposal rows automatically.

### 3. Polling vs triggered

**Triggered, not polled.** The current flow:

```
client → supabase.functions.invoke('ai-parse-transcript', { meeting_id, transcript })
```

There is one cron precedent in the project: `compute-staleness` runs hourly via `pg_cron` + `pg_net` to call an edge function. That's the pattern to copy if a future staging-table approach is added, but the recommendation below avoids the need.

### 4. Input format

Raw text, format-agnostic. The parser prompt explicitly says:

> The content may be in any format: raw text, timestamped notes, VTT/SRT subtitles, or structured meeting notes. Handle all formats gracefully.

Whatever HiNotes returns (verbatim dialogue with `[mm:ss] Speaker N:` lines, markdown summaries, plain text) goes straight in.

### 5. Source / type field

`meetings.source` is free-form text. Use `'hinotes_sync'` to identify these rows.

Combine with `import_mode` to control downstream behavior:
- `import_mode = 'active'` for current/recent meetings → AI extracts action items into the proposals queue
- `import_mode = 'archive'` for backfill of older meetings → AI summarizes only, no proposals (avoids polluting the queue with stale "commitments")

**There is no dedupe field for arbitrary external sources yet.** `ics_uid` exists but is reserved for calendar ICS UIDs — repurposing it would break calendar sync. Recommend adding a new column `external_source_id text` (with a partial unique index per user when not null) so the script can dedupe by HiNotes shortId. See "what I need from you" below.

### 6. Client library

Either works. Recommendation:

- **Python**: use `supabase-py` (the official Python SDK). Cleanest path.
- **Alternative**: hit PostgREST directly via `requests` if you want zero deps.

The script must authenticate as **service role**, not as a user — it's a background process. Pass `SUPABASE_SERVICE_ROLE_KEY` (the same secret the edge functions use). Keep it in env, never commit.

---

## Recommended architecture

```
Python script (your Mac)
   1. Pulls new HiNotes meetings via HiNotes API
   2. For each new meeting, INSERT into public.meetings:
        user_id            = your profile id (env var)
        title              = HiNotes title
        start_time         = HiNotes createTime
        attendees          = HiNotes speakers
        transcript         = verbatim dialogue
        source             = 'hinotes_sync'
        import_mode        = 'active'  (or 'archive' for backfill)
        external_source_id = HiNotes shortId   ← new column, requested below
   3. Invokes the edge function:
        POST {SUPABASE_URL}/functions/v1/ai-parse-transcript
        Authorization: Bearer {SERVICE_ROLE_KEY}
        Content-Type: application/json
        body: { meeting_id: <uuid>, transcript: <string> }
```

That's the whole integration. No staging table, no cron, no triggers. Same pipeline the browser uses today.

### Why not a staging table

- Adds a polling worker, more failure modes, harder to debug
- You'd be re-implementing what the edge function already does
- Direct write + invoke is the same number of API calls and reuses everything
- A staging table only makes sense if you have many disparate sources writing async — you don't

### Edge function notes

The `ai-parse-transcript` function does its own JWT verification in code. It must be deployed with `--no-verify-jwt` so the gateway doesn't double-check and reject calls. This is already configured for the deployed function — no action needed.

When invoking the function:
- The `Authorization` header should be `Bearer <SERVICE_ROLE_KEY>` for server-to-server calls
- The function will read the JWT, verify the user, and proceed
- A service role key has full access; the function still scopes its work to the user_id passed in the payload

---

## Heads up: existing HiNotes path

There is already a `hinotes-fetch` edge function in the repo that does single-meeting ingestion via public share URLs. It hits these undocumented HiNotes endpoints:

```
GET https://hinotes.hidock.com/v1/share/note?shortId=<token>
GET https://hinotes.hidock.com/v1/share/transcription/list?shortId=<token>
```

It returns the verbatim per-utterance transcript formatted as `[mm:ss] Speaker N: <text>`. No HiNotes auth required for share-token URLs.

Tradeoff with the Python sync approach:
- **`hinotes-fetch`** works for individual share URLs the user manually pastes. No auth, public endpoints.
- **Python sync** uses real HiNotes auth and pulls the user's full meeting list automatically. Much more powerful but requires a script running locally.

Both paths can coexist.

---

## What I need to wire this up cleanly

1. **Confirm I should add the `external_source_id` column** on `meetings`, with a partial unique index per user when not null. Migration is ~5 lines. This gives the Python script a clean dedup key.

2. **Service role key handling**: the script needs `SUPABASE_SERVICE_ROLE_KEY` in env. This is the same secret used by edge functions. Don't commit it, don't log it.

3. **Optional reference Python wrapper**: I can write a small `resurface_writer.py` module that wraps the create-meeting + invoke-parse pattern so the sync script just calls one function. Good for keeping the integration code clean. Tell me yes/no.

---

## Schema migration (when ready)

```sql
-- Add external source id column for non-ICS provenance dedup
alter table public.meetings
  add column external_source_id text;

create unique index idx_meetings_user_external_source
  on public.meetings(user_id, external_source_id)
  where external_source_id is not null;
```
