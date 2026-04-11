# Resurface -- Project State

> Comprehensive reference document. Last updated: April 11, 2026.

---

## What It Is

A single-user, AI-augmented task management system built for a sales professional managing multiple parallel client pursuits. The core problem: 5-10 meetings per day across different accounts, and commitments, action items, and relational obligations slip through the cracks. Resurface treats AI as infrastructure -- meeting transcripts are automatically ingested, parsed into structured proposals, and queued for human review before becoming canonical data.

**Differentiating premise**: AI is a peer, not a feature bolt-on. Tasks are surfaced, prioritized, decomposed, classified, enriched, and explained by AI continuously.

---

## Architecture

```
+-----------------------------------------------------------------+
|  FRONTEND (Vercel -- auto-deploy on push to main)               |
|  React 19 + Vite 8 + TypeScript 6                               |
|  Tailwind v4 (dark theme only)                                  |
|  TanStack Query 5 (data + cache)                                |
|  React Router 7                                                 |
|  @dnd-kit (kanban, stream reorder)                              |
|  lucide-react (icons)                                           |
+--------------------------+--------------------------------------+
                           | HTTPS + Supabase JS client
                           v
+-----------------------------------------------------------------+
|  SUPABASE                                                       |
|                                                                 |
|  +---------------+  +-------------+  +----------------+         |
|  | Postgres 17   |  | Auth        |  | Realtime       |         |
|  | + RLS         |  | (email/pwd) |  | subscriptions  |         |
|  | + pg_trgm     |  +-------------+  +----------------+         |
|  | + pg_cron     |                                              |
|  | + pg_net      |  +-------------------------------+           |
|  +---------------+  | Edge Functions (22, Deno/TS)  |           |
|                     | AI: chat, item-chat, decompose|           |
|                     |   classify, easy-button,      |           |
|                     |   parse-transcript, assists,   |           |
|                     |   goal-chat, distill-profile,  |           |
|                     |   meeting-briefing             |           |
|                     | Infra: compute-staleness,     |           |
|                     |   evaluate-goals, backfill-    |           |
|                     |   identities, fix-identity-    |           |
|                     |   links, retry-unprocessed     |           |
|                     | Integrations: jamie-webhook,  |           |
|                     |   calendar-sync, ics-sync,     |           |
|                     |   microsoft-oauth-exchange,    |           |
|                     |   microsoft-sync-calendar      |           |
|                     +---------------+---------------+           |
|                                     |                           |
+-------------------------------------+---------------------------+
                                      |
                                      v
                     +----------------------------+
                     |  Anthropic API             |
                     |  claude-sonnet-4-20250514  |
                     |  Temp: 0.3-0.4            |
                     +----------------------------+

Side channels:
+--------------------------------+
| MCP Server (Node, local stdio) |  Claude Desktop / Claude Code
| 9 tools: direct read/write     |  can interact with Resurface
| to Resurface via Supabase      |  data directly
+--------------------------------+
```

**Data flow**: User action -> React component -> TanStack Query mutation -> Edge Function -> Claude API + Postgres -> Response -> Realtime update -> UI re-render

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | React | 19.2.4 |
| Build | Vite | 8.0.4 |
| Language | TypeScript | ~6.0.2 (strict) |
| Data fetching | TanStack Query | 5.96.2 |
| Routing | React Router | 7.14.0 |
| Styling | Tailwind CSS | 4.2.2 (via @tailwindcss/vite) |
| Icons | lucide-react | 1.7.0 |
| Drag & drop | @dnd-kit/core + sortable | 6.3.1 / 10.0.0 |
| Database | Postgres 17 (Supabase) | -- |
| Auth | Supabase Auth | email/password |
| Functions | Supabase Edge Functions | Deno/TypeScript |
| AI model | Claude Sonnet 4 | claude-sonnet-4-20250514 |
| Frontend hosting | Vercel | auto-deploy |

**Extensions**: pg_trgm (fuzzy search), pgcrypto (UUID), pg_cron (hourly jobs), pg_net (HTTP from SQL)

**Secrets** (Edge Function env):
- `ANTHROPIC_API_KEY` -- Claude API
- `SB_SERVICE_ROLE_KEY` -- Supabase service role (SB_ prefix because SUPABASE_ is reserved)
- `JAMIE_WEBHOOK_API_KEY` -- Jamie webhook auth
- `RESURFACE_DEFAULT_USER_ID` -- single-user UUID for webhook flows

---

## Data Model (20+ tables)

### Core Entities

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| **profiles** | Extends auth.users | display_name, settings JSONB (timezone, working hours/days, bio raw+distilled, Microsoft tokens, ICS URL) |
| **streams** | Work categories | name, color, icon, sort_order, is_archived, field_templates JSONB |
| **items** | Tasks/cards | title, description, status, next_action, resistance (1-5), stakes (1-5), staleness_score, due_date, custom_fields JSONB, parent_id, source_meeting_id, snoozed_until, pinned, tracking, search_vector |
| **meetings** | Discussions | title, start/end_time, attendees[], transcript, transcript_summary, extracted_decisions, extracted_open_questions, source, import_mode, external_source_id, processed_at |
| **proposals** | AI extraction queue | proposal_type, source_type, source_id, evidence_text, normalized_payload, accepted_payload, confidence, ambiguity_flags[], status, review_action, resulting_object_type/id |
| **commitments** | Obligations | title, counterpart, company, do_by, promised_by, needs_review_by, status, direction (outgoing/incoming), source_meeting_id, evidence_text, confidence |
| **pursuits** | Threads of focus | name, description, company, status (active/won/lost/archived), color, template_id |
| **goals** | Strategic objectives | name, description, status (active/completed/archived), template_id |
| **people** | Identity directory | name, email, company_id, role, aliases |
| **companies** | Organization directory | name, domain, aliases, notes |

### Junction & Support Tables

| Table | Purpose |
|-------|---------|
| **pursuit_members** | Polymorphic join: pursuit -> item/commitment/meeting |
| **goal_tasks** | Tasks linked to goals |
| **goal_milestones** | Milestone conditions on goals |
| **item_links** | Cross-references: related/blocks/blocked_by/parent/follow_up |
| **item_assists** | Cached AI assists (approach/context/draft) per item |
| **activity_log** | Per-item history (created, status_changed, touched, etc.) |
| **chat_messages** | AI chat history, scoped: global / item / goal |
| **memories** | User facts for AI context |
| **meeting_attendees** | Junction: meeting -> person |
| **templates** | Reusable process maps |
| **template_steps** | Steps within templates |
| **pursuit_playbook_steps** | Playbook progress tracking with evidence |

### Key Relationships
- items -> streams (many-to-one, nullable; null = uncategorized)
- items -> items (parent_id self-ref for sub-tasks)
- items -> meetings (source_meeting_id)
- items <-> items (item_links cross-references)
- pursuits -> items/commitments/meetings (via pursuit_members)
- goals -> items (via goal_tasks)
- people -> companies (company_id)
- meetings -> people (via meeting_attendees)
- All tables RLS-protected by user_id

### Search
- `search_everything()` Postgres RPC: full-text (tsvector) + fuzzy (pg_trgm) across items + meetings
- `SECURITY DEFINER` with explicit user_id parameter
- Available via Cmd+K and as AI chat tool

### Cron
- `compute-staleness` runs hourly via pg_cron + pg_net

---

## Project Structure

```
src/
  components/     24 components (UI building blocks)
  pages/          22 pages (route-level)
  hooks/          22 hooks (TanStack Query data layer)
  contexts/       AuthContext (session management)
  lib/            types.ts, supabase.ts, queryClient.ts,
                  parseQuickAdd.ts, priorityScore.ts, userContext.ts
  App.tsx         Route definitions
  main.tsx        Entry point

supabase/
  functions/      22 Edge Functions (Deno/TypeScript)
  migrations/     21 SQL migrations
  _shared/        CORS headers, auth helpers, identity resolution

docs/             Spec, system overview, integration guides
mcp-server/       Local MCP server for Claude Desktop/Code
```

---

## Routes (22)

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Dashboard | Stats, stale items, upcoming meetings, pending proposals |
| `/focus` | Focus | Top 10 priority items + pinned; constrained daily view |
| `/river` | DashRiver | Timeline waterfall of all items with clustering |
| `/streams` | Streams | List/kanban view of items by stream |
| `/stream/:id` | StreamDetail | Single stream with all its items |
| `/items/:id` | ItemDetail | Full item: edit, chat, decompose, links, assists |
| `/meetings` | Meetings | Meeting list with calendar view |
| `/meetings/:id` | MeetingDetail | Transcript, extracted data, proposals |
| `/proposals` | Proposals | Triage queue for AI-extracted proposals |
| `/proposals/analytics` | ProposalAnalytics | Accept rates, sources, types |
| `/commitments` | Commitments | Outgoing/incoming obligations tracker |
| `/pursuits` | Pursuits | Pursuit threads grouped by status |
| `/pursuits/:id` | PursuitDetail | Pursuit context, linked items, playbook, team |
| `/goals` | Goals | Goals grouped by status |
| `/goals/:id` | GoalDetail | Goal with milestone tasks, chat |
| `/people` | People | Person directory from meetings/commitments |
| `/people/:id` | PersonDetail | Profile, meetings, commitments, pursuits |
| `/companies` | Companies | Company directory |
| `/companies/:id` | CompanyDetail | Profile, people, pursuits, commitments |
| `/settings` | Settings | Profile, timezone, bio, integrations |
| `/login` | Login | Email/password auth |
| `/auth/microsoft/callback` | MicrosoftCallback | OAuth2 redirect handler |

---

## Components (24)

| Component | Purpose |
|-----------|---------|
| **Layout** | Main nav sidebar, Cmd+K search trigger, stream list |
| **ItemCard** | Task card with staleness bar, status, due date, company tag |
| **KanbanBoard** | Drag-drop across status columns (dnd-kit) |
| **QuickAddBar** | Inline task creation with #stream / due:date parsing |
| **SearchModal** | Global Cmd+K search (items + meetings) |
| **ChatPanel** | Main chat interface with file attachments |
| **ItemChat** | Per-item chat thread with starter prompts |
| **GoalChat** | Per-goal chat thread |
| **ProposalCard** | Proposal review: accept/edit/merge/reject actions |
| **DecomposeSection** | AI decomposition into subtasks |
| **ItemAssistsSection** | AI assist facets (Approach, Context, Draft) |
| **ItemLinkSection** | Manage item cross-references |
| **AddToPursuit** | Modal to add items/commitments to pursuits |
| **PlaybookHealth** | Pursuit playbook progress tracker |
| **MeetingBriefing** | Pre-meeting context generator |
| **EasyButtonModal** | "Easy Win" AI suggestion |
| **InlineEditable** | Reusable inline text editor |
| **StatusBadge** | Status indicator chip (5 types) |
| **StreamFormModal** | Create/edit stream with field templates |
| **SuggestedMerges** | People merge suggestions |
| **TemplateEditor** | Manage process templates |
| **OnboardingWizard** | First-run stream creation |
| **ErrorBoundary** | Error handling with reload |

---

## Hooks (22)

All hooks use TanStack Query for caching, mutations, and optimistic updates.

| Hook | Purpose |
|------|---------|
| **useAuth** | Session, user, signOut |
| **useItems** | Query items with filters (stream, status, sort) |
| **useStreams** | Query/create/update/reorder streams |
| **useMeetings** | Query meetings, create manual meetings |
| **useProposals** | Query by status/source, accept/reject/merge |
| **useCommitments** | Query/create/update commitments |
| **usePursuits** | Query/create/update/delete pursuits, manage members |
| **useGoals** | Query/create/update goals, apply templates |
| **usePeople** | Query people, merge duplicates |
| **useCompanies** | Query companies, get people/pursuits |
| **useChat** | Send messages to ai-chat |
| **useItemChat** | Per-item chat messages |
| **useItemAssists** | Generate AI assists |
| **useItemLinks** | Query/create/delete cross-references |
| **useSearch** | Global full-text + fuzzy search |
| **useProfile** | Fetch/update profile, distill bio |
| **useMemories** | Fetch/delete user memories |
| **useActivityLog** | Per-item activity history |
| **useTemplates** | Query/create/update/delete process templates |
| **useEasyButton** | AI "Easy Win" recommendation |
| **useMicrosoft** | OAuth exchange, calendar sync |
| **useRealtimeSubscription** | Supabase Postgres change subscriptions |

---

## Edge Functions (22)

### AI Functions
| Function | Purpose |
|----------|---------|
| **ai-chat** | Main chat agent with tool use (list_tasks, get_task, search_tasks, create_task, update_task, create_stream, list_streams) |
| **ai-item-chat** | Per-item conversational AI (full item context + chat history) |
| **ai-item-assist** | Generate approach/context/draft assists for an item |
| **ai-decompose** | Break item into 3-7 subtasks with due dates |
| **ai-classify** | Suggest stream for uncategorized items |
| **ai-easy-button** | Pick lowest-resistance task + AI guidance |
| **ai-goal-chat** | Per-goal conversational thread |
| **ai-distill-profile** | Condense user bio |
| **ai-parse-transcript** | Central extraction engine: synopsis, action items, decisions, questions, commitments |
| **meeting-briefing** | Pre-meeting briefing (attendee context, commitments, pursuits) |

### Infrastructure Functions
| Function | Purpose |
|----------|---------|
| **compute-staleness** | Hourly cron: update staleness scores for all items |
| **evaluate-goals** | Periodic goal progress evaluation |
| **backfill-identities** | Populate people/companies from free-text fields |
| **fix-identity-links** | Reconcile duplicate people/companies |
| **retry-unprocessed** | Retry failed proposal processing |

### Integration Functions
| Function | Purpose |
|----------|---------|
| **jamie-webhook** | Receive transcripts from Jamie (meetjamie.ai) |
| **calendar-sync** | Sync ICS feed into meetings table |
| **ics-sync** | Import ICS events from file upload |
| **microsoft-oauth-exchange** | Exchange OAuth code for refresh token |
| **microsoft-sync-calendar** | Fetch Calendar events from Microsoft Graph |

---

## Ingestion Pipeline

Data enters through four paths, all writing to `meetings` and invoking `ai-parse-transcript`:

1. **Jamie Webhook** (primary, real-time): Jamie POSTs `meeting.completed` -> webhook validates `x-jamie-api-key` -> inserts meeting -> fire-and-forget to parser -> returns 200 immediately. Dedup via `external_source_id`.

2. **Manual Paste**: User pastes transcript in `/meetings` form -> creates meeting row -> invokes parser -> proposals created.

3. **HiNotes Sync** (legacy): Python script `scripts/hinote/sync_hinotes.py`. Unused since April 9 pivot to Jamie.

4. **ICS/Calendar Sync**: ICS feed or Microsoft Graph -> creates calendar-sourced meetings.

**Parser failure safety net**: `compute-staleness` cron detects `processed_at IS NULL` meetings and retries up to 5/hour.

---

## Proposal Queue (Governance Layer)

AI never writes directly to items or commitments. Everything goes through proposals.

**Lifecycle**: AI extracts -> `status = 'pending'` -> user reviews in `/proposals` -> accept / edit / merge / not actionable / dismiss as banter

**Types**: task, commitment (outgoing/incoming), memory, draft, deadline_adjustment

**Review UI** (ProposalCard): Shows evidence quote, confidence score, ambiguity flags, type selector, editable fields, stream assignment.

---

## Priority & Staleness System

**Staleness**: Server-computed hourly. Items decay automatically based on time since `last_touched_at`. Drives surfacing on Focus dashboard.

**Priority scoring** (`src/lib/priorityScore.ts`):
- Staleness weight: 40%
- Stakes weight: 30%
- Resistance weight: 10% (inverse -- lower resistance = higher priority)
- Due urgency weight: 20% (overdue=100, today=90, <=3d=60, <=7d=30)

**Staleness levels**: fresh (<20), aging (20-39), stale (40-59), critical (60+)

**Surface reasons** (chips): Overdue, Due today, Due soon, Nd stale, High stakes, High resistance, Waiting

**Suggested moves**: Do Now (overdue/high-stakes with next_action), Break Down (high resistance + high stakes), Open (default)

---

## AI Capabilities

| Capability | Description |
|-----------|-------------|
| **Classification** | On item create: suggest stream, custom fields, company, next action |
| **Decomposition** | Break task into 3-7 subtasks with descriptions, next actions, due dates |
| **Transcript parsing** | Synopsis + action items + decisions + open questions + commitments. Strict criteria: only explicit commitments, no speculative items |
| **Chat agent** | Tool-using agent: list/get/search/create/update tasks, list streams/companies, get counts. Proposed items require user confirmation; updates execute immediately |
| **Per-item chat** | Conversational AI with full item context (source meeting, siblings, pursuit, commitments) + starter prompts (Approach, Context, Draft) |
| **Per-goal chat** | Goal-scoped conversation thread |
| **Easy Win** | Pick lowest-resistance task + provide guidance |
| **Meeting briefing** | Pre-meeting context: attendee history, shared commitments, pursuit status |
| **Bio distillation** | Condense long bio into 2-4 sentence factual profile |
| **Goal evaluation** | Periodic assessment of goal progress |

**User context injection**: Every AI call includes display name, bio (raw + distilled), timezone, working hours/days, current date/time, memories.

---

## Features Built

### Foundation
- Email/password auth via Supabase with RLS on all tables
- Realtime subscriptions for live updates across tabs
- Vercel auto-deploy on push to main
- Onboarding wizard (first-run stream creation)
- Error boundary with reload
- Data export (JSON dump)
- PWA manifest (installable on desktop/mobile)

### Items (Tasks)
- Full CRUD with inline editing (title, description, next_action, due, custom fields, company)
- Status flow: open -> in_progress -> waiting -> done / dropped
- Resistance + Stakes (1-5 dot ratings)
- Staleness score (server-computed hourly) with color-coded bars
- Touch +1d (snooze 24h), Pin to Focus (manual override), Tracking mode (observe-only)
- Custom fields JSONB (company lives here)
- Linked items (related, blocks, blocked_by, parent, follow_up)
- Sub-tasks (parent_id hierarchy with siblings view)
- Source meeting linkback
- Activity timeline
- Quick-add bar with #stream / due:date parsing
- AI decomposition, classification, assists, per-item chat

### Streams
- CRUD with color palette (no grey), icon, field templates
- Drag-to-reorder in sidebar
- Archive support
- Uncategorized virtual stream
- List view + Kanban view (drag between status columns)

### Meetings (Discussions)
- Manual create with date picker, paste transcript -> AI parsing
- Structured synopsis (Overview, Key Topics, Participants, Outcomes)
- Extracted action items, decisions, open questions
- Per-action company extraction + suggested due date
- "Tasks from this discussion" backlink section
- Pre-meeting briefing generation
- Jamie webhook ingestion (primary capture method)
- ICS feed sync, Microsoft Graph integration (built, blocked by EPAM admin)

### Proposals
- Triage queue: accept / edit / merge / not actionable / dismiss as banter
- Type switching (task / outgoing commitment / incoming commitment)
- Confidence scores and ambiguity flags
- Analytics page: accept rates, sources, types
- Tracking flag for observe-only items

### Commitments
- Outgoing (you owe) and incoming (owed to you)
- Counterpart, company, do_by / promised_by / needs_review_by dates
- Status: open / met / broken / cancelled / waiting
- Source meeting linkback with evidence text

### Pursuits
- Threads of focus: bundle items, commitments, meetings under one banner
- Status: active / won / lost / archived
- Polymorphic membership (items, commitments, meetings)
- Playbook health tracking with evidence flags and completion %
- Company association
- Template support

### Goals
- Strategic objectives with milestone tasks
- Status: active / completed / archived
- Per-goal chat thread
- Template support

### People & Companies
- People directory: name, email, company, role, aliases
- Company directory: name, domain, aliases, notes
- Meeting attendee linking
- Suggested merge for duplicates (first-name matching, email resolution)
- Backfill from free-text fields

### Views
- **Dashboard** (`/`): Top stats, stale items, upcoming meetings, pending proposals
- **Focus** (`/focus`): Top 10 priority + pinned, capped view, surface reason chips, suggested moves, Easy Win button
- **River** (`/river`): Timeline waterfall with clustering
- **Streams** (`/streams`): List + Kanban, per-stream or all

### Search
- Global Cmd+K modal
- Full-text + fuzzy via search_everything RPC
- Items and meetings unified
- Highlighted match snippets, keyboard navigation

### Integrations
- **Jamie** (meetjamie.ai): Primary capture. Webhook ingestion, speaker-attributed transcripts
- **MCP Server**: 9 tools for Claude Desktop / Claude Code
- **Microsoft Graph OAuth**: Built end-to-end, blocked at EPAM tenant
- **ICS feed sync**: Google Calendar and other published calendars
- **Vercel**: Auto-deploy on push

---

## Design Premises

1. **Externalize everything** -- the app is your second brain
2. **AI suggests, user confirms** -- proposals require user action; updates are immediate (less destructive)
3. **Staleness is first-class** -- items decay automatically; untouched things surface themselves
4. **Constrained daily view** -- Focus caps at 10 + pinned; rest is browsable
5. **Pin overrides algorithm** -- manual override when the system gets it wrong
6. **Action-oriented** -- every item has a next_action (the very next physical step)
7. **Discussions are inputs** -- transcripts get parsed into structured proposals
8. **AI is contextual** -- every AI call gets bio, timezone, working hours, current date
9. **Tools, not snapshots** -- chat agent has live DB tools, not frozen data
10. **Tasks know companies** -- company tags extracted automatically or set manually
11. **Three-layer separation** -- capture (Jamie) / substrate (tables, proposals) / intelligence (parser, chat); swapping capture tools requires zero substrate/intelligence changes

---

## Open Items / Not Yet Built

| Item | Notes |
|------|-------|
| Morning briefing email/in-app | Daily summary cron; foundation exists |
| Cross-task context enrichment | Auto-search related items/meetings on task create |
| Memory extraction from chats/transcripts | Schema ready, extraction not running |
| Pattern detection (weekly insights) | Proactive AI surfacing ("you snoozed this 4x") |
| Smart status suggestions | AI proposes status changes based on activity |
| Light mode | Dark-only currently |
| Performance audit / code split | Bundle ~620KB, no lazy loading |
| Responsive mobile layout | PWA installs but not phone-optimized |
| Real Outlook integration | Blocked by EPAM admin policy |

## Excluded by User
- Email forwarding / inbound parsing
- Push notifications
- Today's meetings on dashboard
- Calendar gap awareness for AI scheduling

## Phase 2 (Deferred)
- Semantic vector search (pgvector)
- Multi-user / collaboration (schema supports it)

---

## Counts Summary

| Aspect | Count |
|--------|-------|
| React components | 24 |
| Pages / routes | 22 |
| Custom hooks | 22 |
| Edge Functions | 22 |
| Database tables | 20+ |
| SQL migrations | 21 |
| AI model calls | 10 distinct function types |
