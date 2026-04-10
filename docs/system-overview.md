# Resurface -- System Overview

> Authoritative technical reference for the Resurface application as of April 9, 2026.
> Written for AI-assisted pressure testing: architecture review, gap analysis, and strategic suggestions.

---

## 1. Executive Summary

Resurface is a single-user, AI-augmented task management system designed for a sales professional managing multiple parallel client pursuits. The core problem it solves: when you have 5-10 meetings per day across different accounts (S&P, Adobe, Cvent, Chanel, GES, Darden, etc.), things slip. Commitments made in a Tuesday call are forgotten by Thursday. Action items from transcripts never become tasks. The relational, soft-obligation side of sales work -- "I'll follow up", "let me circle back" -- has no system of record.

Resurface treats AI as infrastructure, not a feature bolt-on. Meeting transcripts are automatically ingested via Jamie (meetjamie.ai) webhooks, parsed by Claude Sonnet 4 into structured proposals (action items, commitments, decisions, open questions), and queued for human review before becoming canonical data. The system computes staleness scores hourly, surfaces priority-ranked items on a daily focus dashboard, and provides per-item conversational AI that has full context of the source meeting, related pursuits, sibling items, and commitments.

The application is built on Supabase (Postgres + Edge Functions + Auth + Realtime) with a React 19 frontend deployed on Vercel. All AI calls route through Supabase Edge Functions so the Anthropic API key never touches the browser. The architecture deliberately separates three layers: a capture layer (Jamie, HiNotes legacy, manual paste), a substrate layer (tables, proposals, commitments, pursuits), and an intelligence layer (parser, chat, assists). This separation means switching capture tools -- as happened when the user moved from HiNotes to Jamie on April 9, 2026 -- requires zero changes to the substrate or intelligence layers.

---

## 2. Tech Stack

### Frontend
- **React** 19.2.4 (via Vite 8.0.4)
- **TypeScript** ~6.0.2 (strict mode)
- **TanStack Query** 5.96.2 (data fetching, caching, mutations)
- **React Router** 7.14.0 (client-side routing)
- **Tailwind CSS** 4.2.2 (via `@tailwindcss/vite` plugin; dark theme only, no light mode)
- **lucide-react** 1.7.0 (icons)
- **@dnd-kit/core** 6.3.1 + **@dnd-kit/sortable** 10.0.0 (kanban boards, stream reorder)
- **Hosting**: Vercel (auto-deploy on push to main)

### Backend
- **Supabase** (project ref: `biapwycemhtdhcpmgshp`)
  - Postgres 17 with RLS on all tables
  - Extensions: `pg_trgm` (fuzzy search), `pgcrypto` (UUID generation), `pg_cron` (hourly jobs), `pg_net` (HTTP from SQL)
  - Supabase Auth (email/password provider)
  - Supabase Realtime (subscriptions on items, meetings, chat_messages, proposals, commitments, pursuits, pursuit_members, item_assists)
  - Supabase Storage (private `transcripts` bucket with RLS)
  - Edge Functions (Deno/TypeScript)

### AI
- **Claude Sonnet 4** (`claude-sonnet-4-20250514`) via direct Anthropic API calls from Edge Functions
- Temperature: 0.3 for transcript parsing, 0.4 for chat and assists
- Max tokens: 4096 for parsing, 2048 for chat/assists

### Secrets (Edge Function environment)
- `ANTHROPIC_API_KEY` -- Claude API access
- `SB_SERVICE_ROLE_KEY` -- Supabase service role (named with `SB_` prefix because Supabase reserves the `SUPABASE_` namespace)
- `JAMIE_WEBHOOK_API_KEY` -- shared secret for Jamie webhook auth
- `RESURFACE_DEFAULT_USER_ID` -- UUID of the single user (for webhook-initiated flows that lack a JWT)

---

## 3. Data Model

### 3.1 profiles

Extends `auth.users`. Created automatically via a `SECURITY DEFINER` trigger on `auth.users` insert.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK (FK to auth.users) | User identity |
| `display_name` | text | Used in AI prompts to identify "the user" |
| `settings` | jsonb | Timezone, working hours/days, bio (raw + AI-distilled), Microsoft OAuth tokens, ICS URL, notification preferences |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | Auto-updated via trigger |

### 3.2 streams

User-defined work categories (e.g., "Client Work", "Internal Ops", "Personal").

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `user_id` | uuid FK | Owner |
| `name` | text | Display name |
| `color` | text | Hex color (no grey -- grey means uncategorized) |
| `icon` | text | lucide icon name |
| `sort_order` | int | Sidebar ordering |
| `is_archived` | boolean | Hidden from active views |
| `field_templates` | jsonb | Array of `{key, label, type, options}` for stream-specific custom fields |
| `created_at` | timestamptz | |

### 3.3 items

The core task/card entity. Every actionable thing in the system is an item.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `user_id` | uuid FK | Owner |
| `stream_id` | uuid FK (nullable) | Category; null = uncategorized |
| `title` | text | Primary display text |
| `description` | text | Longer context |
| `status` | text | `open` / `in_progress` / `waiting` / `done` / `dropped` |
| `next_action` | text | The very next physical step |
| `resistance` | int (1-5) | How hard it is to start (5 = highest friction) |
| `stakes` | int (1-5) | How much it matters if this slips |
| `last_touched_at` | timestamptz | Reset on any meaningful interaction; drives staleness |
| `staleness_score` | float | Server-computed hourly; composite of time + stakes + deadline urgency |
| `due_date` | date | Hard deadline |
| `custom_fields` | jsonb | Company and stream-specific fields live here |
| `ai_suggested_stream` | text | AI classification suggestion (informational) |
| `ai_confidence` | float | AI's confidence in the stream suggestion |
| `parent_id` | uuid FK (self-ref) | Sub-task hierarchy |
| `source_meeting_id` | uuid FK | The meeting this item was extracted from |
| `snoozed_until` | timestamptz | Hidden from Today's Focus until this time |
| `pinned` | boolean | Manual override to force into Today's Focus |
| `tracking` | boolean | Observing others' work; excluded from Focus and staleness |
| `search_vector` | tsvector (generated) | Full-text index over title + description + next_action + custom_fields |
| `created_at` / `updated_at` / `completed_at` | timestamptz | Lifecycle timestamps |

### 3.4 meetings

Discussions imported from any source. The universal ingestion target.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `user_id` | uuid FK | Owner |
| `title` | text | AI-suggested or user-provided |
| `start_time` / `end_time` | timestamptz | When the meeting occurred |
| `attendees` | text[] | Speaker names (from Jamie diarization or manual entry) |
| `transcript` | text | Raw transcript text, any format |
| `transcript_summary` | text | AI-generated structured markdown synopsis |
| `extracted_action_items` | jsonb | Legacy; now always `[]` (superseded by proposals table) |
| `extracted_decisions` | jsonb | Array of `{decision, context}` objects |
| `extracted_open_questions` | jsonb | Array of `{question, owner}` objects |
| `source` | text | Free-form provenance: `manual`, `transcript_upload`, `jamie_webhook`, `hinotes_sync`, `ics_import` |
| `import_mode` | text | `active` (creates proposals) or `archive` (summary only, no proposals) |
| `external_source_id` | text | Namespaced dedup key, e.g., `jamie:meeting:abc123` or `hinotes:note:5967655381143564288` |
| `ics_uid` | text | Reserved for calendar ICS dedup |
| `processed_at` | timestamptz | Set by parser on success; null = unprocessed |
| `search_vector` | tsvector (generated) | Full-text index over title + summary + transcript |

### 3.5 proposals

The governance layer between AI extraction and canonical data. AI never writes directly to items or commitments.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `user_id` | uuid FK | Owner |
| `proposal_type` | text | `task` / `commitment` / `memory` / `draft` / `deadline_adjustment` |
| `source_type` | text | `meeting` / `transcript` / `chat` / `manual` / `reconciliation` |
| `source_id` | uuid | FK to the source record (e.g., meeting UUID) |
| `evidence_text` | text | Verbatim quote from the transcript supporting this proposal |
| `normalized_payload` | jsonb | AI's structured interpretation (title, description, dates, company, assignee, etc.) |
| `accepted_payload` | jsonb | May differ from normalized after user edits at review time |
| `confidence` | float (0-1) | AI confidence; explicit commitments start at 0.75, implied at 0.55, commitments at 0.6 |
| `ambiguity_flags` | text[] | `no_due_date`, `implied_commitment`, `social_language`, `relative_date`, `external_dependency`, `ambiguous_actionability`, `no_counterpart` |
| `status` | text | `pending` / `accepted` / `rejected` / `merged` / `dismissed` |
| `review_action` | text | `accept` / `edit` / `merge` / `not_actionable` / `dismiss_banter` |
| `resulting_object_type` / `resulting_object_id` | text / uuid | What was created on acceptance |
| `merge_target_id` | uuid | If merged into an existing item |
| `created_at` / `reviewed_at` / `updated_at` | timestamptz | |

### 3.6 commitments

Soft obligations -- relational promises that may not have a clean deliverable.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `user_id` | uuid FK | Owner |
| `title` | text | Short summary ("Follow up with Holly on contract") |
| `description` | text | Longer context |
| `counterpart` | text | Who the promise was made to (free text) |
| `company` | text | Account/client tag |
| `do_by` | date | Internal target date (primary) |
| `promised_by` | date | External commitment date (what you told someone) |
| `needs_review_by` | date | If someone else must review first |
| `status` | text | `open` / `met` / `broken` / `cancelled` / `waiting` |
| `direction` | text | `outgoing` (you owe) / `incoming` (owed to you) |
| `source_meeting_id` | uuid FK | Meeting where this was committed |
| `source_item_id` | uuid FK | Item this commitment relates to |
| `evidence_text` | text | Verbatim quote |
| `confidence` | float (0-1) | AI extraction confidence |
| `created_at` / `updated_at` / `completed_at` | timestamptz | |

### 3.7 pursuits

User-flagged threads of focus that collect items, commitments, and meetings under one banner.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `user_id` | uuid FK | Owner |
| `name` | text | Unique per user (case-insensitive index) |
| `description` | text | |
| `company` | text | Account/client this pursuit is about |
| `status` | text | `active` / `won` / `lost` / `archived` |
| `color` | text | Hex color (default: purple `#8B5CF6`) |
| `sort_order` | int | |
| `created_at` / `updated_at` / `completed_at` | timestamptz | |

### 3.8 pursuit_members

Polymorphic join table linking pursuits to items, commitments, and meetings.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `pursuit_id` | uuid FK | |
| `member_type` | text | `item` / `commitment` / `meeting` |
| `member_id` | uuid | The entity's UUID (not a real FK -- polymorphic) |
| `added_at` | timestamptz | |

Unique constraint on `(pursuit_id, member_type, member_id)` prevents duplicate membership.

### 3.9 item_links

Cross-references between items.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `source_item_id` / `target_item_id` | uuid FK | The two items being linked |
| `link_type` | text | `related` / `blocks` / `blocked_by` / `parent` / `follow_up` |
| `created_at` | timestamptz | |

Unique on `(source_item_id, target_item_id, link_type)`.

### 3.10 activity_log

Per-item history for UI timeline and staleness context.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `item_id` | uuid FK | |
| `action` | text | `created`, `status_changed`, `touched`, etc. |
| `details` | jsonb | Action-specific metadata |
| `created_at` | timestamptz | |

### 3.11 chat_messages

AI conversation history, scoped globally or per-item.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `role` | text | `user` / `assistant` |
| `content` | text | Message body |
| `actions_taken` | jsonb | Array of actions (proposed items, stream suggestions, updates) |
| `scope_type` | text | `global` (sidebar chat) / `item` (per-item thread) |
| `scope_id` | uuid | Points at the item UUID when scope_type = `item` |
| `created_at` | timestamptz | |

### 3.12 memories

Discrete facts the AI knows about the user. Schema is built; extraction is not running yet.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `content` | text | The fact |
| `source` | text | `user_added` / `extracted_from_chat` / `extracted_from_transcript` / `extracted_from_item` |
| `created_at` | timestamptz | |

### 3.13 item_assists

Persistent "Help me" AI responses per item. Three types: approach, context, draft. Legacy -- the UI has been replaced by the per-item chat (ai-item-chat), but the table and data remain in the schema.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `item_id` | uuid FK | |
| `assist_type` | text | `approach` / `context` / `draft` |
| `content` | text | AI-generated markdown |
| `model` | text | Model identifier (e.g., `claude-sonnet-4-20250514`) |
| `generated_at` | timestamptz | |

Unique on `(item_id, assist_type)` -- regeneration overwrites.

### RLS Pattern

Every table has Row-Level Security enabled. The standard policy is:

```sql
create policy "Users can manage own <table>"
  on <table> for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

Exceptions:
- `item_links`: checks ownership via a subquery on the source item
- `pursuit_members`: checks ownership via a subquery on the parent pursuit

The `search_everything()` function uses `SECURITY DEFINER` with an explicit `searching_user_id` parameter to bypass RLS while still scoping to the correct user.

---

## 4. Ingestion Pipeline

Data enters Resurface through four paths. All paths ultimately write to the `meetings` table and invoke `ai-parse-transcript`.

### 4.1 Manual Paste / Upload (the Add Discussion form)

**Trigger**: User pastes text into the textarea on `/meetings` and clicks "Add Discussion".

**Flow**:
1. Frontend creates a meeting row via Supabase client (with `source = 'manual'` or `'transcript_upload'`, `import_mode = 'active'` or `'archive'`)
2. Frontend invokes `ai-parse-transcript` Edge Function with the meeting_id and transcript text
3. Parser extracts structured data and writes proposals
4. Frontend receives the parse result and updates the UI

**Writes**: One `meetings` row + N `proposals` rows.

### 4.2 Jamie Webhook (real-time, fire-and-forget)

**Trigger**: Jamie (meetjamie.ai) POSTs a `meeting.completed` event to `/functions/v1/jamie-webhook` when a recording finishes processing.

**Flow**:
1. Webhook verifies `x-jamie-api-key` header against `JAMIE_WEBHOOK_API_KEY` secret
2. Parses Jamie's payload (metadata + summary + speaker-attributed transcript array)
3. Formats transcript as `[mm:ss] SpeakerName: text` lines
4. Inserts a meeting row (`source = 'jamie_webhook'`, `import_mode = 'active'`, `external_source_id = 'jamie:meeting:<id>'`)
5. Dedup: unique index on `(user_id, external_source_id)` catches duplicates; 23505 error is swallowed and returns 200 idempotently
6. Fire-and-forget `fetch()` to `ai-parse-transcript` using service role key (not awaited)
7. Returns 200 to Jamie immediately with meeting_id and segment count

**If the parser fails**: The meeting row exists but `processed_at` remains NULL. The hourly `compute-staleness` cron job includes a safety net that re-triggers parsing for any meetings with `processed_at IS NULL` and a non-empty transcript (capped at 5 per cycle).

**Writes**: One `meetings` row (immediately) + N `proposals` rows (async, after parser completes).

### 4.3 HiNotes Python Sync (legacy, batch)

**Trigger**: Manual execution of `scripts/hinote/sync_hinotes.py` on the user's local Mac.

**Flow**:
1. Script authenticates to HiNotes' private API (`/v2/note/list`, `/v2/note/transcription/list`, `/v2/note/detail`, `/v2/note/speaker/list`) using a browser-extracted `AccessToken`
2. Paginates through the user's HiNotes meeting list
3. For each meeting: fetches segments, builds speaker name mappings from summary annotations, formats transcript
4. Inserts meeting row via PostgREST (`source = 'hinotes_sync'`, `external_source_id = 'hinotes:note:<note_id>'`)
5. Invokes `ai-parse-transcript` via service role key
6. 0.5s sleep between meetings to avoid hammering APIs

**CLI modes**:
- `--days N`: sync last N days (default 7), `import_mode = 'active'`
- `--backfill`: sync all available meetings, `import_mode = 'archive'`
- `--dry-run`: preview without writes

**Status**: Legacy as of April 9, 2026. Kept in git but unused since the pivot to Jamie.

### 4.4 HiNotes URL Fetch (legacy, ad-hoc)

**Trigger**: User pastes a HiNotes share URL (`https://hinotes.hidock.com/s/<shortId>` or `/v/<shortId>`) into the discussion form.

**Flow**:
1. Frontend detects the HiNotes URL pattern
2. Invokes `hinotes-fetch` Edge Function with the URL
3. Function hits two undocumented public HiNotes endpoints in parallel:
   - `GET /v1/share/note?shortId=<token>` (metadata, markdown outline)
   - `GET /v1/share/transcription/list?shortId=<token>` (per-utterance dialogue)
4. Builds speaker name mappings from `Name (Speaker N)` patterns in the markdown
5. Returns structured JSON (verbatim transcript preferred, markdown fallback)
6. Frontend creates the meeting row and triggers parsing as in the manual path

**Status**: Legacy. No auth required (public via share token). Undocumented API -- could break at any HiNotes redeploy.

---

## 5. AI Parser (ai-parse-transcript)

**Source**: `supabase/functions/ai-parse-transcript/index.ts`

The central extraction engine. Every ingestion path feeds into this single function.

### What It Extracts

1. **Synopsis** (structured markdown): Overview, Key Topics Discussed, Participants & Perspectives, Outcomes & Next Steps
2. **Suggested Title**: 4-10 words, company + topic when both are clear
3. **Discussion-level Company**: The account/client the entire meeting is about
4. **Action Items** with: title, description, commitment_strength (`explicit`/`implied`), evidence_quote (verbatim, under 200 chars), company, assignee (`user`/`<name>`/`unknown`), urgency (`high`/`medium`/`low`), suggested_due_date, related_item_ids
5. **Decisions**: `{decision, context}` pairs
6. **Open Questions**: `{question, owner}` pairs
7. **Commitments** (outgoing only): title, description, counterpart, company, do_by, promised_by, needs_review_by, evidence_quote, ambiguity_flags

### Strict Action Item Criteria

The prompt enforces a binary test: an item counts ONLY if someone explicitly committed to act (first-person language, accepted assignment, or specific named assignment). Items that are merely discussed, hypothetical, aspirational, or historical are excluded. "Speculative" strength items (below "implied") are dropped entirely before proposal creation.

### Commitment vs. Action Item Distinction

An action_item is a clean deliverable ("send the deck by Friday"). A commitment is a social/relational obligation ("I'll follow up", "I owe him one"). The parser extracts both separately. Some statements legitimately produce both an action item and a commitment.

### Speaker Attribution

The prompt receives:
- The user's display name from the `profiles` table
- The meeting's `attendees[]` array (from Jamie speaker diarization or manual entry)
- Instructions to use the attendee list + contextual cues when transcripts lack speaker labels

All action items are included regardless of assignee. The `isUserAssignee()` helper in the function does name normalization (case-insensitive, token matching, first-name matching) but is only used for the response metadata (`not_for_user` count), not for filtering.

### Meeting-Date-Aware Relative Date Resolution

The prompt is explicitly told the meeting date and day-of-week:

> This meeting took place on 2026-04-09 (a Thursday). When the transcript uses relative date language ("tomorrow", "next week", "by Friday"), resolve it against the MEETING date -- NOT against the date you're processing this transcript.

This prevents a meeting from April 2 that says "I'll do it tomorrow" from getting April 10 as the due date when parsed on April 9.

### Dual Auth Model

The function accepts two authentication modes:
1. **Browser JWT**: Extracted from `Authorization: Bearer <jwt>`, verified via `adminClient.auth.getUser()`, ownership checked against the meeting's `user_id`
2. **Service Role Key**: Token matches `SB_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`); `user_id` derived from the meeting record itself. Used by the Jamie webhook, Python sync, and manual re-trigger via curl.

### Proposal Creation

For active-mode meetings:
1. Clears any existing pending proposals from this meeting (re-parse safety)
2. Filters to titled, non-speculative action items
3. Creates one `proposal_type = 'task'` row per action item
4. Creates one `proposal_type = 'commitment'` row per extracted commitment
5. Falls back to discussion-level company when per-item company is null

For archive-mode meetings: Summary/decisions/questions are written but proposal creation is skipped entirely. Any stale pending proposals from a prior active-mode parse are deleted.

### Fire-and-Forget Invocation

The Jamie webhook invokes the parser via a non-awaited `fetch()` call. The webhook returns 200 to Jamie immediately. If the parser fails, the `compute-staleness` cron job detects meetings with `processed_at IS NULL` and retries up to 5 per hour.

### Auto-Renaming

If the meeting's current title is a placeholder (empty, starts with "Untitled", looks like a filename, or matches an HDA timestamp pattern), the parser's AI-suggested title replaces it.

---

## 6. Proposal Queue

The review layer between AI extraction and canonical data. The user explicitly chose this governance pattern to prevent AI-extracted banter, hedged language, vague timing, and false obligations from polluting the live system.

### Proposal Lifecycle

1. AI writes proposals with `status = 'pending'`
2. User reviews in the `/proposals` page (ProposalCard component)
3. Review actions:
   - **Accept**: Creates the canonical item or commitment, sets `resulting_object_type` and `resulting_object_id`
   - **Edit**: User modifies payload before acceptance (changes stored in `accepted_payload`)
   - **Merge**: Links to an existing item via `merge_target_id`
   - **Not Actionable**: Dismissed -- the statement wasn't really an action item
   - **Dismiss as Banter**: Dismissed -- social noise, not work

### Type Selector

On the ProposalCard, the user can change the `proposal_type`:
- **Task**: Creates an item on acceptance
- **Outgoing Commitment**: Creates a commitment with `direction = 'outgoing'`
- **Incoming Commitment**: Creates a commitment with `direction = 'incoming'`

### Tracking Flag

When accepting a task proposal, the user can toggle the **tracking** flag. Tracked items represent someone else's work that the user wants to observe. Tracked items appear on pursuit pages but are excluded from Today's Focus and do not accumulate staleness.

### Pursuit Assignment at Acceptance

The ProposalCard includes an AddToPursuit component that lets the user assign the item to one or more pursuits at the moment of acceptance.

### Evidence-First Card Design

The proposal review UI is structured as: AI label (type + confidence) -> verbatim quote from transcript -> AI's structured interpretation -> action buttons. This puts the source evidence front-and-center so the user can judge whether the AI's interpretation is correct.

---

## 7. Commitment Ledger

### Multi-Date Model

Unlike tasks (which have a single `due_date`), commitments have three date fields:
- **`do_by`** (primary): The internal target -- when you actually need to finish
- **`promised_by`**: The external commitment date -- what you told someone
- **`needs_review_by`**: If someone else must review before the deadline

In practice, the parser mostly populates `do_by`. The other two are escape hatches for the rare case where the user needs to track all three windows.

### Direction

- **Outgoing** (`direction = 'outgoing'`): You owe someone. "I'll follow up", "I'll send the deck". Default direction.
- **Incoming** (`direction = 'incoming'`): Someone owes you. "Holly is sending me the contract Friday". Tracked without putting it on your to-do list.

The AI parser currently extracts outgoing commitments only (the prompt explicitly restricts to statements made by the user).

### Status Lifecycle

`open` -> `met` / `broken` / `cancelled` / `waiting`

### Creation Paths

1. **AI extraction**: Parser identifies soft obligations in transcripts -> proposal of type `commitment` -> user accepts
2. **Manual entry**: User creates a commitment directly (Commitments page)
3. **Proposal acceptance**: When accepting a task proposal, user can reclassify it as a commitment via the type selector

---

## 8. Pursuits

Pursuits are user-flagged threads of focus that prevent important work from fading when other tasks crowd the daily view.

### What a Pursuit Collects

Via the polymorphic `pursuit_members` table, a pursuit can contain:
- **Items** (`member_type = 'item'`)
- **Commitments** (`member_type = 'commitment'`)
- **Meetings** (`member_type = 'meeting'`)

### Status Lifecycle

`active` -> `won` / `lost` / `archived`

`won` and `lost` are sales-specific terminal states (e.g., the deal closed or was lost). `archived` is a generic wrap-up for non-deal pursuits.

### AddToPursuit Component

A reusable component that appears on item detail pages, proposal cards, and commitment detail views. It presents a dropdown of active pursuits and lets the user add/remove membership. When accepting a proposal, pursuit assignment happens inline at acceptance time.

### Tracked Items on Pursuit Pages

Items with `tracking = true` appear on pursuit pages but are visually distinguished from regular items. They represent someone else's deliverable that the user wants to observe in the context of a pursuit.

### Company Inheritance

Pursuit records have a `company` field. When sub-tasks are created from items in a pursuit, they inherit the company from the parent. The parser also sets company on proposals based on the discussion-level company detection.

---

## 9. Item Intelligence

### 9.1 Item-Scoped Chat (ai-item-chat)

**Source**: `supabase/functions/ai-item-chat/index.ts`

Each item has its own persistent conversation thread stored in `chat_messages` with `scope_type = 'item'` and `scope_id = <item_id>`.

**Context gathering** (on every message):
1. Item details: title, description, next_action, due_date, status, stream
2. Source meeting: title, date, attendees, transcript_summary
3. Pursuits the item belongs to (with company and description)
4. Sibling items in the same pursuits (up to 10)
5. Related commitments from the same source meeting (up to 10)
6. User display name and today's date

**Three starter prompts** offered to the user when starting a new thread:
1. **Approach**: "How should I tackle this?"
2. **Context**: "What do I know about this?"
3. **Draft**: "Write me something for this"

The system prompt instructs Claude to be specific and practical, reference actual people and dates from the context, cite source meetings by name, and generate ready-to-use artifacts (no placeholders) for drafts.

**Thread history**: The function reads up to 40 prior messages from the thread and sends the full history + system context + new user message to Claude. User messages are persisted before calling Claude so they appear immediately in the UI even if the AI call fails.

### 9.2 Static Assists (ai-item-assist) -- Legacy UI, Active Backend

**Source**: `supabase/functions/ai-item-assist/index.ts`

Three assist types with distinct prompt instructions:
- **Approach**: 4-7 numbered concrete steps starting with the smallest physical next move
- **Context**: Four sections: What this is about, What's been discussed (citing source meetings), Open questions, Who's involved
- **Draft**: Infers the right format (email, agenda, memo, checklist, etc.) and generates a ready-to-use artifact

Results are upserted into `item_assists` (regeneration overwrites via unique constraint). The context gathering mirrors `ai-item-chat` including linked items via `item_links`.

The UI for static assists has been replaced by the per-item chat, but the function and table remain operational.

### 9.3 Easy Win Button

A dashboard feature (not modified in recent sessions) that picks the lowest-resistance open task and provides AI guidance on completing it quickly. Uses the `ai-easy-button` Edge Function.

---

## 10. Priority & Staleness System

### Compute-Staleness (Backend Cron)

**Source**: `supabase/functions/compute-staleness/index.ts`

Runs hourly via `pg_cron` + `pg_net`. For every active, non-tracking item:

```
staleness_score = baseDecay + stakesMultiplier + deadlineUrgency

where:
  baseDecay = log2(hoursSinceLastTouch + 1) * 10
  stakesMultiplier = stakes * 5              (stakes: 1-5, so 5-25 points)
  deadlineUrgency = 100 if overdue
                  = 50  if due within 24h
                  = 25  if due within 72h
                  = 0   otherwise
```

Done/dropped items are zeroed. Tracking items are excluded from the query.

**Known issue**: `deadlineUrgency` uses raw UTC midnight comparison (`new Date(item.due_date).getTime()`) rather than the noon-local-time comparison used in the frontend. The frontend fix (`daysUntilDue`) computes at noon local time to avoid off-by-one errors from timezone differences; the backend has not been updated.

### Frontend Priority Score

**Source**: `src/lib/priorityScore.ts`

`computePriority()` is a weighted sum:

```
priority = staleness * 0.4 + stakes * 0.3 + (6 - resistance) / 5 * 0.1 + dueUrgency * 0.2
```

Components are normalized to 0-100 scale. Lower resistance increases priority (easier to start = more likely to complete).

### effectiveStalenessLevel

A pure staleness label based ONLY on time-since-last-touch, deliberately NOT conflated with due-date urgency:
- `fresh`: score < 20
- `aging`: score < 40
- `stale`: score < 60
- `critical`: score >= 60

Due-date signals are shown separately via `getSurfaceReasons` chips.

### getSurfaceReasons

Generates user-visible chip labels explaining why an item surfaced:
- "Nd overdue" (red)
- "Due today" (orange)
- "Due soon" (orange)
- "Nd stale" (orange) -- isolates the time-only component by subtracting stakes and deadline contributions
- "Getting stale" (yellow)
- "High stakes" (red)
- "High resistance" (yellow)
- "Waiting" (blue)

### daysUntilDue

Compares at noon local time on both dates to avoid the off-by-one from `new Date("2026-04-10")` being midnight UTC. An item due today stays "due today" all day regardless of when the user looks.

### Touch +1d

Moves `last_touched_at` forward by one day. If the resulting day falls on a weekend (Saturday or Sunday), it skips to Monday. This resets the staleness clock without requiring real work.

### Pinning and Snoozing

- **Pinned items** (`pinned = true`) always sort above non-pinned items in `sortByPriority()`, regardless of score
- **Snoozed items** (`snoozed_until` set to a future timestamp) are filtered out of Today's Focus until the snooze expires

### Today's Focus Ranking

Dashboard caps at 10 items + all pinned items. Items are sorted by `sortByPriority()` (pinned first, then descending composite priority). Snoozed items are excluded. Tracking items are excluded.

---

## 11. Frontend Architecture

### Routing (React Router 7)

All routes are nested under `<Layout />` except `/login`:

| Route | Page Component | Purpose |
|-------|----------------|---------|
| `/` | Dashboard | Today's Focus -- priority-ranked items |
| `/proposals` | Proposals | Review queue for AI-extracted proposals |
| `/commitments` | Commitments | Commitment ledger (outgoing + incoming) |
| `/pursuits` | Pursuits | List of active pursuits |
| `/pursuits/:id` | PursuitDetail | Items, commitments, meetings in one pursuit |
| `/streams` | Streams | Stream management (CRUD, reorder) |
| `/stream/:id` | StreamDetail | Items in a stream (list + kanban views) |
| `/items/:id` | ItemDetail | Full item view with chat, metadata, actions |
| `/meetings` | Meetings | Discussion list + add form |
| `/meetings/:id` | MeetingDetail | Synopsis, decisions, questions, linked items |
| `/settings` | Settings | Profile, bio, timezone, working hours, integrations |
| `/auth/microsoft/callback` | MicrosoftCallback | OAuth callback (built, blocked by EPAM admin) |

### Sidebar Navigation Order

1. Dashboard
2. Proposals
3. Commitments
4. Pursuits
5. Streams
6. Discussions (label for `/meetings`)
7. Settings

Below the nav items: a "Streams" section listing all user streams with colored dots, plus an "Uncategorized" virtual stream (always visible, shows count badge when items exist).

Bottom of sidebar: user email + sign-out button.

### Top Bar

Search button (opens SearchModal, Cmd+K shortcut) + AI Chat toggle button (opens/closes the sidebar ChatPanel).

### Key Components

- **ProposalCard**: Evidence-first review card with type selector, tracking toggle, pursuit assignment, and action buttons
- **AddToPursuit**: Reusable dropdown for adding/removing items from pursuits
- **ItemChat**: Per-item conversational AI thread with starter prompts
- **InlineEditable**: Click-to-edit component used throughout for titles, descriptions, next actions, dates, custom fields
- **KanbanBoard**: Drag-and-drop board on StreamDetail (columns = status values)
- **ChatPanel**: Global sidebar chat (scope_type='global') -- effectively dead weight now that per-item chat exists
- **SearchModal**: Global search via Cmd+K, unified items + meetings, keyboard-navigable
- **ErrorBoundary**: Top-level React error boundary with reload button

### Hook Patterns

- **useQuery**: Data fetching with TanStack Query. Queries use Supabase client directly.
- **useMutation**: Write operations with `onSuccess` callbacks that invalidate relevant query caches.
- **useRealtimeSubscription**: Custom hook that subscribes to Supabase Realtime changes on a table and invalidates TanStack Query caches when rows change. Applied to items, meetings, chat_messages, proposals, commitments, pursuits, pursuit_members.

### Styling

- Tailwind CSS v4 via `@tailwindcss/vite` plugin
- Dark theme throughout (`bg-gray-950` base, `bg-gray-900` sidebar, `bg-gray-800` cards)
- No light mode
- Color palette avoids grey for stream colors (grey = uncategorized semantic)
- Staleness indicators use a green -> yellow -> orange -> red gradient

---

## 12. Integration Architecture

### The Three-Layer Model

Resurface deliberately separates concerns into three layers:

```
CAPTURE LAYER          SUBSTRATE LAYER           INTELLIGENCE LAYER
(what records)         (where data lives)        (what processes data)
                       
Jamie webhook    --->  meetings table      --->  ai-parse-transcript
HiNotes sync     --->  proposals table     --->  ai-item-chat
HiNotes fetch    --->  commitments table   --->  ai-item-assist
Manual paste     --->  items table         --->  compute-staleness
Future tools     --->  pursuits table      --->  ai-classify, ai-decompose
```

This separation was validated on April 9, 2026, when the capture layer pivoted from HiNotes to Jamie. Zero changes were needed in the substrate or intelligence layers. The parser received better data (speaker-attributed transcripts) for free.

### Source-Agnostic Substrate

The `meetings` table accepts any source. Key design choices:
- `source` column is free-form text (not an enum), allowing new sources without schema changes
- `external_source_id` uses namespaced prefixes (`jamie:meeting:`, `hinotes:note:`) so different sources don't collide
- `import_mode` controls downstream behavior independently of source
- `attendees[]` accepts names from any diarization system

### Jamie Webhook Adapter

- Real-time, event-driven (`meeting.completed` webhook)
- Speaker-attributed transcripts (Jamie learns voices and tags by name)
- Auth via shared API key in `x-jamie-api-key` header
- Dedup via `external_source_id = 'jamie:meeting:<id>'`
- Fire-and-forget parser invocation with cron safety net

### HiNotes Adapters (Legacy)

Two adapters, both functional but unused since the Jamie pivot:

1. **URL Fetch** (`hinotes-fetch` Edge Function): Resolves individual HiNotes share URLs via undocumented public endpoints. No auth required. Extracts verbatim transcript + speaker mapping from markdown annotations. Ad-hoc, user-initiated.

2. **Python Sync** (`scripts/hinote/sync_hinotes.py`): Batch script using authenticated HiNotes private API (`/v2/*`). Paginates through the user's meeting list, fetches transcripts and speaker data, inserts meetings, invokes parser. Supports `--days`, `--backfill`, `--dry-run` modes.

### Manual Paste as Universal Fallback

The `/meetings` page accepts raw text in any format: timestamped notes, VTT/SRT subtitles, structured meeting notes, or plain text. The parser prompt explicitly handles all formats. This is the steady-state baseline that works regardless of which capture tool is in use.

---

## 13. What's Deferred

Features designed or discussed but not yet built, organized by the three-wave AI roadmap:

### Wave 2 -- Reuse + Restart + Bookkeeping (not started)
- **Resurfacing briefs**: Cached `item_briefs` that refresh when an item gains focus. Would provide instant "here's what you know about this" context.
- **Rescue plans for stale items**: AI analyzes why an item stalled and suggests a revised first move.
- **Completion ripple effects**: Deterministic downstream updates when an item is completed (e.g., unblock dependent items, update related commitments).
- **Precedent-pack retrieval**: When starting new work similar to past completed work, surface the prior deliverables, approach, and outcomes.

### Wave 3 -- Draft-First + Event-Triggered (not started)
- **Draft-first agents**: Archetype classifier determines what kind of deliverable an item needs, generates it speculatively, stores in `draft_outputs` for approval.
- **Meeting pre-briefs**: Before a scheduled meeting, AI gathers all relevant context (prior meetings with these people, open items, commitments) into a briefing document. Gated on calendar integration stability.
- **Out-of-app action packets**: AI packages a task + context + draft into a standalone artifact (email, PDF) that can be acted on outside Resurface.

### Infrastructure / Feature Gaps
- **Daily/weekly pursuit digest view**: Aggregated view of pursuit activity over time.
- **AI pursuit-membership suggestions**: AI recommends which pursuit a new item should belong to based on company, context, and existing members.
- **Profile distillation from meeting history**: The "Flavor 1" approach -- build a rich user profile from patterns across many transcripts (communication style, decision patterns, common counterparts).
- **Streams evaluation**: Analysis of whether the current stream taxonomy is still useful or needs restructuring.
- **Reconciliation**: Matching new proposals against existing items to suggest merges instead of duplicates.
- **Context Library UI**: Browsable archive of imported meetings organized by company/person/theme, distinct from the active Meetings list.
- **Context mode for old recordings**: `import_mode = 'context'` and `'hybrid'` (designed but only `'active'` and `'archive'` are implemented).
- **Email/Teams ingestion**: Tier 2/3 capture adapters.
- **Memory extraction**: Schema is ready (`memories` table), but no AI is running to populate it from chats or transcripts.
- **Morning briefing**: Daily AI-generated summary of what's on the user's plate.
- **Pattern detection**: Weekly cron that surfaces insights about activity patterns.

---

## 14. Known Limitations & Technical Debt

1. **Speaker identification depends on Jamie's voice learning + correct calendar sync.** If Jamie doesn't recognize a voice, the transcript falls back to generic speaker labels, and attribution degrades. The parser handles this gracefully (includes all items regardless of assignee), but commitment extraction quality drops.

2. **The sidebar ChatPanel is global and not context-aware.** It has `scope_type = 'global'` and no item/pursuit context. It is effectively dead weight now that per-item chat exists. The toggle button and panel remain in the Layout.

3. **`item_assists` table is orphaned.** The UI for static assists (Approach, Context, Draft buttons) has been replaced by the per-item chat thread. The table and Edge Function still exist and are functional, but the UI no longer calls them. Data from prior assists remains in the schema.

4. **HiNotes code is legacy.** Both `scripts/hinote/sync_hinotes.py` and `supabase/functions/hinotes-fetch/index.ts` are kept in the repo but unused since the Jamie pivot. The undocumented HiNotes API endpoints they rely on could break at any time.

5. **Pursuit detail page loads all items/commitments/meetings client-side.** The page fetches all pursuit members and then loads all referenced entities. This works at personal scale (tens of items per pursuit) but would not scale to thousands without server-side pagination or aggregation.

6. **The parser prompt is long (~3K tokens of instructions).** This adds cost to every parsing call and is approaching the limit where instruction-following degrades. No prompt caching is implemented.

7. **No test coverage.** No unit tests, integration tests, or end-to-end tests exist anywhere in the codebase.

8. **No error boundary beyond the top-level React ErrorBoundary.** A failure in any component crashes the entire page. No per-section error isolation.

9. **The `compute-staleness` deadline urgency uses raw UTC midnight comparison.** The frontend's `daysUntilDue()` correctly compares at noon local time to avoid off-by-one errors. The backend cron still uses `new Date(item.due_date).getTime()` which produces midnight UTC, creating a window where staleness scores are incorrectly inflated or deflated depending on the user's timezone.

10. **No prompt caching or model tiering.** Every AI call uses Claude Sonnet 4 at full prompt cost. Simple tasks (classification, decomposition) could use Haiku. The parser prompt is a prime candidate for prompt caching since the instruction prefix is identical across calls.

11. **`memories` table is empty.** Schema exists, extraction logic does not. The Settings UI has a Memories section that is always empty.

12. **The `actions_taken` field on `chat_messages` stores heterogeneous types.** It's a JSON array where entries can be plain strings (legacy), `{type: 'proposed_item', ...}`, `{type: 'proposed_stream', ...}`, or `{type: 'updated', ...}`. No schema validation.

13. **Single-user design.** `RESURFACE_DEFAULT_USER_ID` is a hardcoded secret for webhook flows. The data model supports multi-user via RLS, but the webhook auth and user attribution are single-user.

14. **Bundle size ~620KB with no lazy loading or code splitting.** All pages are eagerly loaded.

---

## 15. Cost Model

### Current AI Spend

Based on typical active use (5-10 meetings per day + chat interactions):

- **Transcript parsing**: ~$0.03-0.08 per meeting (depends on transcript length; ~3K tokens of prompt + variable transcript)
- **Item chat**: ~$0.02-0.05 per exchange (context + history + response)
- **Item assists**: ~$0.02-0.04 per generation (similar to chat but no history)
- **Classification/decomposition**: ~$0.01-0.02 per call

**Daily estimate**: ~$0.50-1.00 for active use
**Monthly estimate**: ~$15-20 per user

### Optimization Levers Available (not implemented)

1. **Prompt caching**: The parser's ~3K-token instruction prefix is identical across calls. Anthropic's prompt caching could reduce input token cost by ~90% for this prefix.
2. **Model tiering**: Use Haiku for simple tasks (classification, decomposition, profile distillation) and reserve Sonnet for parsing and chat. Could cut costs by 50-70% on those calls.
3. **Batch API**: For non-real-time operations (staleness cron re-parsing, backfill), the Anthropic Batch API offers 50% cost reduction.
4. **Shorter parser prompt**: The prompt is comprehensive but could be compressed without losing extraction quality.

---

## 16. User Context

### Who Built This

Dustin Collis, a sales/account executive at EPAM (a digital consulting firm). Manages multiple client pursuits simultaneously across accounts including S&P, Adobe, Cvent, Chanel, GES, Darden, and others.

### The Core Problem

5-10 meetings per day produce a high volume of cross-cutting context. Action items from a Tuesday call with Adobe get buried by Wednesday's S&P pricing review. Soft commitments ("I'll follow up with Holly on the contract") have no system of record and slip when sales work takes over. The relational side of sales -- promises made, favors owed, follow-ups implied -- is the first thing to fall when the day gets busy.

### The Hygiene Workflow

Daily routine: ~20 minutes split between:
1. **Jamie**: Fix any speaker misidentifications in the transcript (Jamie's voice learning improves over time but isn't perfect)
2. **Resurface**: Triage the proposal queue (accept/reject/reclassify AI-extracted items), tag items to pursuits, review commitments

### The Capture Layer Pivot

As of April 9, 2026, Jamie replaced HiNotes as the primary transcription tool. The switch was motivated by:
- **Speaker identification**: Jamie learns voices over time and tags speakers by name automatically. HiNotes had inconsistent diarization (some meetings had speaker labels, most didn't).
- **No bot in calls**: Jamie records system audio via a native desktop app. No meeting bot, no participant notification.
- **Calendar sync**: Jamie syncs with Outlook calendar for meeting context.
- **Webhook delivery**: Jamie supports automated webhook delivery of completed meetings, enabling the fire-and-forget ingestion pipeline.

### Strategic Implications

The user explicitly decided NOT to build features that compete with the capture layer (voice fingerprinting, audio recognition). Resurface's value is in the layers Jamie won't touch: cross-meeting profile distillation, pursuit tracking, daily review, commitment ledger, AI-assisted triage, and draft generation. Better capture data (from Jamie) makes the intelligence layer more valuable, not less.

---

## Edge Function Inventory

For reference, all deployed Edge Functions:

| Function | Purpose | Auth |
|----------|---------|------|
| `ai-parse-transcript` | Central transcript extraction engine | Dual (JWT + service role) |
| `ai-item-chat` | Per-item conversational AI | Dual |
| `ai-item-assist` | Static "Help me" generation (3 types) | Dual |
| `ai-chat` | Global sidebar chat with tool use (6 read tools) | JWT |
| `ai-classify` | Stream + company classification on item creation | JWT |
| `ai-decompose` | Break a task into 3-7 sub-tasks | JWT |
| `ai-easy-button` | Pick lowest-resistance task + guidance | JWT |
| `ai-distill-profile` | Compress bio into 2-4 sentence factual profile | JWT |
| `compute-staleness` | Hourly cron: update staleness scores + re-trigger failed parses | No auth (cron) |
| `jamie-webhook` | Receive Jamie meeting.completed events | API key |
| `hinotes-fetch` | Resolve HiNotes share URLs (legacy) | JWT |
| `ics-sync` | ICS calendar feed sync | JWT |
| `microsoft-oauth-exchange` | Microsoft Graph OAuth token exchange | JWT |
| `microsoft-sync-calendar` | Sync Outlook calendar events (blocked by EPAM admin) | JWT |
