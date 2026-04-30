# Resurface -- Product & System Specification

> Single source of truth for the Resurface application.
> Updated: 2026-04-16. Maintained automatically by Claude Code sessions and `scripts/refresh-spec.mjs`.

---

## 1. Vision & Problem

Resurface is a single-user, AI-augmented task management system built for a sales professional managing multiple parallel client pursuits simultaneously.

**The core problem**: 5-10 meetings per day across accounts (S&P, Adobe, Cvent, Chanel, GES, Darden, etc.) produce a high volume of cross-cutting context. Action items from a Tuesday call get buried by Wednesday. Soft commitments -- "I'll follow up with Holly on the contract" -- have no system of record. The relational side of sales work (promises made, favors owed, follow-ups implied) is the first thing to fall when the day gets busy.

**What Resurface does**: Meeting transcripts are automatically ingested (via Jamie webhooks), parsed by Claude into structured proposals (action items, commitments, decisions, open questions), and queued for human review before becoming canonical data. Items decay over time via a staleness system that surfaces neglected work. AI is infrastructure, not a feature bolt-on -- it classifies, decomposes, enriches, and explains tasks continuously.

**The daily workflow**: ~20 minutes split between fixing Jamie speaker IDs and triaging Resurface's proposal queue (accept/reject/reclassify AI-extracted items, tag to pursuits, review commitments).

**Who built this**: Dustin Collis, a Content GTM lead at EPAM (a digital consulting firm). Commerce is NOT his remit (a counterpart owns it).

---

## 2. Design Premises

1. **Externalize everything** -- the app is your second brain
2. **AI suggests, user confirms** -- proposals require human action; updates execute immediately (less destructive)
3. **Staleness is first-class** -- items decay automatically; untouched things surface themselves
4. **Constrained daily view** -- Focus caps at 10 + pinned; the rest is browsable
5. **Pin overrides algorithm** -- manual override when the system gets it wrong
6. **Action-oriented** -- every item has a next_action (the very next physical step)
7. **Discussions are inputs** -- transcripts get parsed into structured proposals
8. **AI is contextual** -- every AI call gets bio, timezone, working hours, current date, memories
9. **Tools, not snapshots** -- the chat agent has live DB tools, not frozen data
10. **Tasks know companies** -- company tags extracted automatically or set manually
11. **Three-layer separation** -- capture (Jamie) / substrate (tables, proposals) / intelligence (parser, chat); swapping capture tools requires zero substrate/intelligence changes

---

## 3. Architecture

```
CAPTURE LAYER          SUBSTRATE LAYER           INTELLIGENCE LAYER
(what records)         (where data lives)        (what processes data)

Jamie webhook    --->  meetings table      --->  ai-parse-transcript
Manual paste     --->  proposals table     --->  ai-item-chat / ai-goal-chat
ICS/calendar     --->  items table         --->  ai-classify, ai-decompose
                       commitments table   --->  ai-cluster-ideas, ai-triage-ideas
                       pursuits table      --->  compute-staleness
                       ideas table         --->  meeting-briefing
                       people/companies    --->  backfill-identities
```

**Stack**: React 19 + Vite 8 + TypeScript 6 + TanStack Query 5 + React Router 7 + Tailwind v4 (dark only) + Supabase (Postgres 17, Auth, Edge Functions, Realtime) + Claude API (Opus 4.6 for interactive, Sonnet 4.6 for batch). Frontend on Vercel (auto-deploy), backend on Supabase.

**AI model tiering** (as of April 2026):
- **Opus 4.6**: Interactive real-time (ai-item-chat, ai-chat, ai-parse-transcript active mode)
- **Sonnet 4.6**: Batch/historical (ai-parse-transcript archive mode, all other AI functions)

---

## 4. Core Entities

### Items (Tasks)
The central work unit. Every actionable thing is an item. Has title, description, next_action (the very next physical step), status (`open` / `in_progress` / `waiting` / `done` / `dropped`), resistance (1-5, how hard to start), stakes (1-5, how much it matters if it slips), staleness_score (server-computed hourly), due_date, custom_fields (JSONB), and company linkage. Supports sub-tasks via parent_id self-reference, source meeting backlinks, snoozed_until (hidden from Focus), pinned (forced into Focus), and tracking mode (observe-only, excluded from Focus and staleness). Full-text search via generated tsvector.

### Meetings (Discussions)
The universal ingestion target. Accepts any source: Jamie webhook, manual paste, ICS import. Stores transcript, AI-generated synopsis (structured markdown), extracted decisions, open questions, extracted topics. Speaker attribution via attendees array and meeting_attendees junction to people. Import mode: `active` (creates proposals) or `archive` (summary only). Dedup via external_source_id with namespaced prefixes (`jamie:meeting:<id>`).

### Proposals (Governance Layer)
AI never writes directly to items or commitments. Everything goes through proposals first. Types: `task`, `commitment`, `memory`, `draft`, `deadline_adjustment`. Each has evidence_text (verbatim quote), normalized_payload (AI interpretation), confidence score (0-1), and ambiguity_flags. User reviews: accept, edit, merge, not_actionable, dismiss_banter, assigned_to_other. On acceptance, creates the canonical item or commitment. Supports AI-suggested merge targets for dedup.

### Commitments (Obligation Ledger)
Soft obligations -- relational promises that may not have a clean deliverable. Direction: outgoing (you owe) or incoming (owed to you). Multi-date model: do_by (internal target), promised_by (external commitment), needs_review_by (if someone must review first). Status: `open` / `met` / `broken` / `cancelled` / `waiting` / `historical`. Linked to counterpart (person), company, source meeting, and source item. Evidence text from transcript.

### Pursuits
User-flagged threads of focus that prevent important work from fading. Collects items, commitments, and meetings via polymorphic pursuit_members. Status: `active` / `won` / `lost` / `archived`. Supports playbook templates with evidence-based step tracking. Company association. Color-coded.

### Goals
Strategic objectives above pursuits. Have milestone tasks (goal_tasks) with computed success conditions: manual, or auto-complete when a linked pursuit/item/commitment reaches a target status, or count-based thresholds. Per-goal chat thread. Template support.

### Ideas
Strategic/tactical concepts surfaced from meetings. AI extracts candidate ideas from transcripts. Quality triage (high/medium/low) filters noise. Clustered by conceptual similarity (ai-cluster-ideas). Each cluster gets AI-generated reports (5 types: strategic assessment, action plan, competitive landscape, account map, trend analysis). Can be promoted to Goals or Pursuits.

### People & Companies
Canonical identity layer normalizing free-text names across meetings, commitments, pursuits, items. People: name, email, aliases, company_id, role. Companies: name, domain, aliases, notes. Meeting attendee junction. Suggested merge for duplicates. Backfill from existing free-text fields.

### Streams
User-defined work categories (e.g., "Client Work", "Internal Ops"). Color, icon, sort order. Support custom field templates (JSONB). Archivable. Uncategorized is a virtual stream.

### Follow-Ups
Post-meeting relational closing moves -- the "thanks, here's what I took away, I'll get back to you on X" message. Distinct from commitments (which span weeks and have deliverables) and tasks (which are the work itself). One follow-up per meeting (when warranted), each with one or more recipients and a per-recipient AI-drafted body. Status: `pending` / `sent` / `dismissed`. Per-recipient `sent_at` lets the user mark each addressee individually (one click = copies the body to clipboard + stamps that recipient sent). The follow-up rolls up to `sent` when every recipient is stamped, or `dismissed` if the user gives up. AI-extracted by `ai-parse-transcript` (writes directly to `follow_ups`, no proposal-queue round trip -- mirrors the memories pattern). Persists indefinitely; `/follow-ups` groups by age (Today / Yesterday / Earlier this week / Older) so lateness is visible without UI dimming.

---

## 5. Ingestion Pipeline

### Jamie Webhook (primary, real-time)
Jamie (meetjamie.ai) POSTs `meeting.completed` -> webhook validates `x-jamie-api-key` -> inserts meeting row -> fire-and-forget to parser -> returns 200 immediately. Dedup via unique index on `(user_id, external_source_id)`. Raw payload logged to `webhook_payload_log` for disaster recovery.

### Manual Paste
User pastes transcript on `/meetings` -> creates meeting row -> invokes `ai-parse-transcript` -> proposals created. Accepts any format: timestamped notes, VTT/SRT, structured notes, plain text.

### ICS/Calendar Sync
ICS feed or Microsoft Graph (built, blocked by EPAM admin) -> creates calendar-sourced meetings.

### Parser Failure Safety Net
`compute-staleness` cron detects meetings with `processed_at IS NULL` and retries up to 5 per hour.

---

## 6. AI Parser (ai-parse-transcript)

The central extraction engine. Every ingestion path feeds here.

**Extracts**: Synopsis (structured markdown), suggested title, discussion-level company, action items (with commitment_strength, evidence_quote, assignee, urgency, suggested_due_date), decisions, open questions, commitments (outgoing only), ideas, memories, and follow-ups (post-meeting relational touches with per-recipient drafts).

**Strict criteria**: An item counts ONLY if someone explicitly committed to act (first-person language, accepted assignment, specific named assignment). Speculative items are dropped. Commitments are social/relational obligations distinct from clean deliverables.

**Meeting-date-aware**: Relative dates ("tomorrow", "next Friday") resolve against the meeting date, not the processing date.

**Dual auth**: Browser JWT or service role key. Service role used by webhook, sync scripts, and manual re-trigger.

**Active vs archive mode**: Active creates proposals. Archive writes summary/decisions/questions but skips proposals.

---

## 7. Proposal Queue

Evidence-first review cards: AI label -> verbatim quote -> structured interpretation -> action buttons.

**Type selector**: Task, outgoing commitment, incoming commitment. User can reclassify at review time.

**Tracking flag**: Accept as "tracking" = observe-only (appears on pursuit pages but excluded from Focus/staleness).

**Pursuit assignment**: Inline at acceptance time via AddToPursuit component.

**Delegation**: "Assigned to other" creates a delegated_items record for future "NAME's plate" views.

**AI merge suggestions**: Parser detects potential duplicates against existing items; suggested_merge_target_id shown on the card.

**Analytics**: `/proposals/analytics` shows accept rates, sources, types over time.

---

## 8. Priority & Staleness

### Server-side (compute-staleness, hourly cron)
```
staleness_score = baseDecay + stakesMultiplier + deadlineUrgency
  baseDecay        = log2(hoursSinceLastTouch + 1) * 10
  stakesMultiplier = stakes * 5  (5-25 points)
  deadlineUrgency  = 100 overdue, 50 within 24h, 25 within 72h, 0 otherwise
```
Done/dropped items zeroed. Tracking items excluded.

### Frontend priority score
```
priority = staleness * 0.4 + stakes * 0.3 + (6 - resistance)/5 * 0.1 + dueUrgency * 0.2
```
Lower resistance = higher priority (easier to start = more likely to complete).

### Staleness levels (time-only, not conflated with due dates)
- fresh: < 20 | aging: 20-39 | stale: 40-59 | critical: 60+

### Surface reason chips
Overdue (red), Due today (orange), Due soon (orange), Nd stale (orange), Getting stale (yellow), High stakes (red), High resistance (yellow), Waiting (blue).

### Controls
- **Touch +1d**: Bumps last_touched_at forward 1 day (skips weekends). Resets staleness without real work.
- **Pinned**: Always sorts above non-pinned in Focus, regardless of score.
- **Snoozed**: Hidden from Focus until snoozed_until timestamp passes.
- **Tracking**: Excluded from Focus and staleness entirely.

### Today's Focus
Caps at 10 items + all pinned. Sorted by priority (pinned first, then descending composite). Snoozed and tracking items excluded.

---

## 9. Item Intelligence

### Per-item chat (ai-item-chat)
Persistent conversation thread per item. Context gathered on every message: item details, source meeting (title, date, attendees, summary), pursuits, sibling items (up to 10), related commitments (up to 10), user profile, today's date. Three starter prompts: Approach, Context, Draft. Up to 40 message history.

### Per-goal chat (ai-goal-chat)
Goal-scoped conversation thread with milestone and linked-task context.

### Chat agent (ai-chat)
Global sidebar chat with tool use: list_tasks, get_task, search_tasks, create_task, update_task, create_stream, list_streams, list_companies, get_counts. Proposed items require user confirmation; updates execute immediately.

### Classification (ai-classify)
On item creation: suggests stream, custom fields, company, next action.

### Decomposition (ai-decompose)
Breaks a task into 3-7 subtasks with descriptions, next actions, due dates.

### Easy Win (ai-easy-button)
Picks the lowest-resistance open task and provides AI guidance on completing it quickly.

### Meeting briefing (meeting-briefing)
Pre-meeting context: attendee history, shared commitments, pursuit status, open items.

### Ideas clustering (ai-cluster-ideas + ai-cluster-report)
Groups ideas by conceptual similarity. Generates 5 report types per cluster (strategic assessment, action plan, competitive landscape, account map, trend analysis). Cached in cluster_reports table.

### Ideas triage (ai-triage-ideas)
Batch scores untriaged ideas as high/medium/low quality. Filters low-signal parser noise. Processes 50 at a time.

---

## 10. Search

Global Cmd+K modal via `search_everything()` Postgres RPC. Full-text (tsvector with websearch_to_tsquery) + fuzzy (pg_trgm) across items and meetings. `SECURITY DEFINER` with explicit user_id parameter. Highlighted match snippets, keyboard navigation. Also available as an AI chat tool.

---

<!-- AUTO:routes -->
## 11. Routes (29)

> Note: ReviewInput has been folded into the unified `/add` page. The `/add` route opens a three-option wizard (File / Paste / Task) that replaces both `/review-input` and the old inline QuickAddBar flow.

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Dashboard | Stats, stale items, upcoming meetings, pending proposals |
| `/morning` | Morning | Daily briefing snapshot (light theme, mobile-first): AI intro + meetings + follow-ups + commitments + tasks |
| `/focus` | Focus | Top 10 priority items + pinned; constrained daily view |
| `/river` | DashRiver | Timeline waterfall of all items with clustering |
| `/streams` | Streams | List/kanban view of items by stream |
| `/stream/:id` | StreamDetail | Single stream with all its items |
| `/items/:id` | ItemDetail | Full item: edit, chat, decompose, links, notes, assists |
| `/meetings` | Meetings | Meeting list + add discussion form |
| `/meetings/:id` | MeetingDetail | Transcript, synopsis, decisions, questions, linked items |
| `/add` | Add | Unified capture wizard: File / Paste / Task (replaces Review Input + QuickAddBar) |
| `/proposals` | Proposals | Triage queue for AI-extracted proposals |
| `/proposals/analytics` | ProposalAnalytics | Accept rates, sources, types |
| `/follow-ups` | FollowUps | Post-meeting follow-up drafts grouped by age |
| `/commitments` | Commitments | Outgoing/incoming obligations tracker |
| `/pursuits` | Pursuits | Pursuit threads grouped by status |
| `/pursuits/:id` | PursuitDetail | Pursuit context, linked items, playbook, team |
| `/goals` | Goals | Goals grouped by status |
| `/goals/:id` | GoalDetail | Goal with milestone tasks, chat |
| `/ideas` | Ideas | Idea clusters with quality filter and report generation |
| `/people` | People | Person directory from meetings/commitments |
| `/people/:id` | PersonDetail | Profile, meetings, commitments, pursuits |
| `/companies` | Companies | Company directory |
| `/companies/:id` | CompanyDetail | Profile, people, pursuits, commitments |
| `/settings` | Settings | Profile, timezone, bio, integrations |
| `/settings/analytics` | Analytics | Index of analytics pages |
| `/settings/analytics/landscape` | Landscape | 2D strategic canvas: items+commitments on Effort×Urgency, pursuit hulls, goal territories |
| `/settings/analytics/ai-calls` | AiCalls | Per-call Claude telemetry: tokens, cache hit rate, latency, cost estimate |
| `/login` | Login | Email/password auth |
| `/auth/microsoft/callback` | MicrosoftCallback | OAuth2 redirect handler |
<!-- /AUTO:routes -->

<!-- AUTO:components -->
## 12. Components (33)

| Component | Purpose |
|-----------|---------|
| AddMenu |  |
| AddToPursuit | Modal to add items/commitments to pursuits |
| BundleChat |  |
| BundleCreateForm |  |
| BundleLayout |  |
| BundleReport |  |
| BundleSource |  |
| ChatPanel | Main chat interface (global scope) |
| DecomposeSection | AI decomposition into subtasks |
| EasyButtonModal | "Easy Win" AI suggestion |
| ErrorBoundary | Error handling with reload |
| FollowUpCard | Follow-up review card with per-recipient drafts and send/dismiss actions |
| GoalChat | Per-goal chat thread |
| GroupingSuggestion |  |
| InlineEditable | Reusable inline text editor |
| ItemAssistsSection | AI assist facets (Approach, Context, Draft) |
| ItemCard | Task card with staleness bar, status, due date, company tag |
| ItemChat | Per-item chat thread with starter prompts |
| ItemLinkSection | Manage item cross-references |
| KanbanBoard | Drag-drop across status columns (dnd-kit) |
| Layout | Main nav sidebar, Cmd+K search trigger, stream list |
| MeetingBriefing | Pre-meeting context generator |
| OnboardingWizard | First-run stream creation |
| PlaybookHealth | Pursuit playbook progress tracker |
| ProposalCard | Proposal review with accept/edit/merge/reject actions |
| PursuitLinkSuggestion |  |
| QuickAddBar | Inline task creation with #stream / due:date parsing |
| SearchModal | Global Cmd+K search (items + meetings) |
| StatusBadge | Status indicator chip (5 types) |
| StreamFormModal | Create/edit stream with field templates |
| SuggestedMerges | People merge suggestions |
| TemplateEditor | Manage process templates |
| TriageSkippedSection |  |
<!-- /AUTO:components -->

<!-- AUTO:hooks -->
## 13. Hooks (36)

| Hook | Purpose |
|------|---------|
| useActivityLog | Per-item activity history |
| useAiTelemetry |  |
| useAuth | Session, user, signOut |
| useBundleChat |  |
| useBundleReport |  |
| useBundles |  |
| useChat | Send messages to ai-chat |
| useClusterReports | Generate and fetch cluster reports |
| useCommitments | Query/create/update commitments |
| useCompanies | Query companies, get people/pursuits |
| useEasyButton | AI "Easy Win" recommendation |
| useFollowUps | Query/update follow-ups, mark recipients sent, dismiss |
| useGoals | Query/create/update goals, apply templates |
| useIdeas | Query/cluster/triage ideas |
| useItemAssists | Generate AI assists |
| useItemChat | Per-item chat messages |
| useItemLinks | Query/create/delete cross-references |
| useItemNotes | Query/add item progress notes |
| useItems | Query items with filters (stream, status, sort) |
| useLandscape |  |
| useMeetings | Query meetings, create manual meetings |
| useMemories | Fetch/delete user memories |
| useMicrosoft | OAuth exchange, calendar sync |
| useMorningBriefing |  |
| usePeople | Query people, merge duplicates |
| useProfile | Fetch/update profile, distill bio |
| useProposalGroups |  |
| useProposals | Query by status/source, accept/reject/merge |
| usePursuitLinkProposals |  |
| usePursuits | Query/create/update/delete pursuits, manage members |
| useRealtimeSubscription | Supabase Postgres change subscriptions |
| useReviewInputs |  |
| useSearch | Global full-text + fuzzy search |
| useStreams | Query/create/update/reorder streams |
| useTemplates | Query/create/update/delete process templates |
| useTriageSkippedInputs |  |
<!-- /AUTO:hooks -->

<!-- AUTO:edge_functions -->
## 14. Edge Functions (27)

### AI Functions
| Function | Purpose | Model |
|----------|---------|-------|
| ai-chat | Main chat agent with tool use (7 read/write tools) | Opus 4.6 |
| ai-classify | Suggest stream for uncategorized items | Sonnet 4.6 |
| ai-cluster-ideas | Group ideas by conceptual similarity | Sonnet 4.6 |
| ai-cluster-report | Generate 5 report types per cluster | Sonnet 4.6 |
| ai-decompose | Break item into 3-7 subtasks | Sonnet 4.6 |
| ai-distill-profile | Condense user bio | Sonnet 4.6 |
| ai-easy-button | Pick lowest-resistance task + guidance | Sonnet 4.6 |
| ai-goal-chat | Per-goal conversational thread | Opus 4.6 |
| ai-item-assist | Generate approach/context/draft assists | Sonnet 4.6 |
| ai-item-chat | Per-item conversational AI | Opus 4.6 |
| ai-parse-input | Parse email/screenshot/pasted-text `inputs` row into proposals (multimodal) | Opus 4.6 |
| ai-parse-preview | Read-only model A/B testing (no DB writes) | configurable |
| ai-parse-transcript | Central extraction engine | Opus 4.6 (active) / Sonnet 4.6 (archive) |
| ai-triage-ideas | Batch score idea quality (high/medium/low) | Sonnet 4.6 |
| meeting-briefing | Pre-meeting attendee context + commitments | Sonnet 4.6 |
| generate-morning-briefing | Daily snapshot: today's meetings + per-attendee context + pending follow-ups + pressing commitments + surfaced tasks. AI synthesizes the 60-second intro paragraph; structured sections rendered deterministically. | Sonnet 4.6 |

### Infrastructure Functions
| Function | Purpose |
|----------|---------|
| compute-staleness | Hourly cron: update staleness scores, retry failed parses |
| evaluate-goals | Periodic goal progress evaluation |
| backfill-identities | Populate people/companies from free-text fields |
| backfill-pursuit-links | One-shot sweep: match historical active-mode meetings to active pursuits |
| ai-catalog-batch | Sonnet triage pass over a batch of inputs; decides which ones get full synthesis |
| fix-identity-links | Reconcile duplicate people/companies |
| retry-unprocessed | Retry failed proposal processing |

### Integration Functions
| Function | Purpose |
|----------|---------|
| jamie-webhook | Receive transcripts from Jamie (meetjamie.ai) |
| calendar-sync | Sync ICS feed into meetings table |
| embed-transcript | Embed transcript chunks for semantic search |
| ics-sync | Import ICS events from file upload |
| microsoft-oauth-exchange | Exchange OAuth code for refresh token |
| microsoft-sync-calendar | Fetch Calendar events from Microsoft Graph |
| search-chunks | Semantic search over transcript chunks |

### Shared
| Directory | Purpose |
|-----------|---------|
| _shared | CORS headers, auth helpers, identity resolution utilities |
<!-- /AUTO:edge_functions -->

<!-- AUTO:tables -->
## 15. Database Tables (42 migrations, 39 tables)

| Table | Source migration |
|-------|-----------------|
| activity_log | 20260407000000_initial_schema |
| ai_call_telemetry | 20260418000000_ai_call_telemetry |
| bundle_chunks | 20260418020000_context_bundles |
| bundle_documents | 20260418020000_context_bundles |
| bundle_entities | 20260418020000_context_bundles |
| bundle_gaps | 20260418020000_context_bundles |
| bundle_reports | 20260418020000_context_bundles |
| bundles | 20260418020000_context_bundles |
| chat_messages | 20260407000000_initial_schema |
| cluster_reports | 20260411010000_cluster_reports |
| commitments | 20260409030000_commitments |
| companies | 20260410020000_people_and_companies |
| delegated_items | 20260413050000_proposal_actions_enhanced |
| follow_ups | 20260429000000_follow_ups |
| goal_tasks | 20260410010000_templates_and_goals |
| goals | 20260410010000_templates_and_goals |
| ideas | 20260411000000_ideas_and_historical |
| inputs | 20260415000100_review_inputs |
| item_assists | 20260409070000_item_assists |
| item_links | 20260407000000_initial_schema |
| item_notes | 20260413000000_item_notes |
| items | 20260407000000_initial_schema |
| meeting_attendees | 20260410020000_people_and_companies |
| meeting_chunks | 20260411000001_meeting_chunks_pgvector |
| meetings | 20260407000000_initial_schema |
| memories | 20260408010000_memories |
| morning_briefings | 20260430000000_morning_briefings |
| people | 20260410020000_people_and_companies |
| profiles | 20260407000000_initial_schema |
| proposal_groups | 20260415000000_proposal_groups |
| proposals | 20260409000000_proposals |
| pursuit_link_proposals | 20260423000000_pursuit_link_proposals |
| pursuit_members | 20260409060000_pursuits |
| pursuit_playbook_steps | 20260410040000_pursuit_playbooks |
| pursuits | 20260409060000_pursuits |
| streams | 20260407000000_initial_schema |
| template_steps | 20260410010000_templates_and_goals |
| templates | 20260410010000_templates_and_goals |
| webhook_payload_log | 20260413100000_webhook_log |
<!-- /AUTO:tables -->

---

## 16. Integrations

### Jamie (primary capture, real-time)
meetjamie.ai records via native desktop app (no bot in calls). Speaker-attributed transcripts via voice learning. Webhook delivery of completed meetings. Calendar sync for meeting context.

### MCP Server (local)
Node.js stdio server with 9 tools for Claude Desktop / Claude Code: direct read/write to Resurface via Supabase.

### Microsoft Graph OAuth
Built end-to-end. Blocked by EPAM tenant admin policy. Handles token exchange, refresh, and calendar event sync.

### ICS Feed
Google Calendar and other published calendars via ICS URL (treated as bearer token).

### Vercel
Auto-deploy on push to main. Env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.

---

## 17. Open Questions & Deferred Work

### Not yet built
| Item | Notes |
|------|-------|
| Morning briefing (daily summary) | Cron foundation exists |
| Memory extraction from chats/transcripts | Transcript extraction shipped 2026-04-18. Chat-sourced extraction still TODO. |
| Meeting Advisor | Post-parse strategic advisor: full transcript + memories + active pursuits + prior meetings with same attendees + open commitments → 1-3 non-obvious recommended moves with rationale and first action. New edge function `ai-meeting-advisor`, JSONB column on meetings. Design: on-demand button v1, per-pursuit auto-run flag in Settings later. NOT "follow up with Bob" — strategic coaching ("pre-brief Holly before Brian's call"). Each move → one-click "Add as task". Parked 2026-04-18 pending other priorities. |
| Memory edit/review page | Once parser-extracted memory volume warrants, build a consolidation UI — group near-duplicates, edit wording, promote to "pinned" tier, etc. Deferred from 2026-04-18 launch. |
| Pattern detection (weekly insights) | "You snoozed this 4x" |
| Smart status suggestions | AI proposes status changes based on activity |
| Cross-task context enrichment | Auto-search related items on task create |
| Resurfacing briefs | Cached item_briefs refreshed on focus |
| Rescue plans for stale items | AI-suggested revised first move |
| Completion ripple effects | Unblock dependents, update commitments |
| Precedent-pack retrieval | Surface prior similar work outcomes |
| Draft-first agents | Speculative artifact generation |
| Meeting pre-briefs | Gated on calendar integration stability |
| Out-of-app action packets | Task + context + draft as email/PDF |
| Reconciliation | Match new proposals against existing items |
| Context Library UI | Browsable archive by company/person/theme |

### Excluded by user
- Email forwarding / inbound parsing
- Email delivery of any kind (morning briefing, daily summary, etc.) — the page is the channel; Dustin reads on his phone in the morning and doesn't want another inbox surface.
- Push notifications
- Calendar gap awareness for AI scheduling
- Light mode (dark-only by design — except `/morning`, where light is intentional)

### Phase 2 (deferred)
- Semantic vector search (pgvector)
- Multi-user / collaboration (schema supports it via RLS)
- **Pre-multi-user security & hardening pass** (gating requirement before any second user is ever provisioned). Scope: (1) audit every `SECURITY DEFINER` function for trust on caller-supplied `user_id` parameters and add `auth.uid() = <param>` guards (currently `search_everything`, `search_meeting_chunks`, `search_bundle_chunks` all trust the parameter); (2) audit every Edge Function that uses `adminClient` for the same pattern (the `generate-morning-briefing` IDOR fix on 2026-04-30 is the template); (3) audit cron-callable endpoints — anonymous fallback to `RESURFACE_DEFAULT_USER_ID` works for single-user but breaks once there's more than one user; (4) audit RLS policy completeness on every table (`webhook_payload_log` was missing it as of 2026-04-30); (5) audit jsonb columns that denormalize PII (`morning_briefings.meetings_data`, `follow_ups.recipients`, etc.); (6) review service-role key scope and rotate; (7) review Anthropic API key blast radius; (8) review the MCP server's auth model. The throughline of every issue caught today: the single-user shortcut of "service role + body-supplied user_id" is a latent IDOR that activates the moment a second user signs up.

---

## 18. Known Limitations

1. **Single-user design**: `RESURFACE_DEFAULT_USER_ID` hardcoded for webhook flows. RLS supports multi-user but webhook auth is single-user.
2. **No test coverage**: Zero unit, integration, or e2e tests.
3. **Bundle ~620KB, no lazy loading**: All pages eagerly loaded.
4. **Not mobile-optimized**: PWA installs but layout isn't phone-friendly.
5. **Staleness cron uses UTC midnight** for deadline comparison; frontend uses noon local time. Off-by-one window exists.
6. **No prompt caching**: Parser's ~3K-token instruction prefix re-sent every call.
7. **Global ChatPanel is dead weight**: Superseded by per-item chat but still in Layout.
8. **item_assists table is orphaned**: UI replaced by per-item chat; table and function remain.
9. **Pursuit detail loads all members client-side**: Works at personal scale, wouldn't scale to thousands.
10. **memories table is empty**: Schema exists, no extraction logic.
11. **HiNotes code is legacy**: Kept in repo, unused since Jamie pivot April 9.

---

## 19. Cost Model

**Daily estimate**: ~$0.50-1.00 for active use (5-10 meetings + chat).
**Monthly estimate**: ~$15-20.

**Optimization levers available** (not implemented):
- Prompt caching (90% reduction on parser instruction prefix)
- Further model tiering (Haiku for classification/decomposition)
- Batch API for non-real-time operations (50% cost reduction)

---

## Changelog

> Append-only. Each Claude Code session that makes substantive changes adds a dated entry here.

- **2026-04-16**: Consolidated docs/system-overview.md + docs/project-state.md into this single SPEC.md. Added AUTO fences for refresh-script-maintained sections. Created scripts/refresh-spec.mjs and weekly drift-check scheduled task.
- **2026-04-17**: New Landscape page at `/settings/analytics/landscape` — strategic 2D canvas plotting items (circles) and commitments (diamonds) on Effort × Urgency axes, with pursuit convex hulls (mid layer) and goal territories (back layer). Size = stakes, opacity = freshness, pulsing ring = Focus 10, dot color = pursuit color. Click pursuit/goal to filter canvas. New hook `useLandscape` bundles items + commitments + pursuits + goals + pursuit_members + linked goal_tasks into a single query. Lives under a new `/settings/analytics` index page (sidebar entry next to Settings) so future analytics views can slot in alongside.
- **2026-04-18**: Unified capture at `/add` — three-option wizard (File / Paste / Task) replaces both `/review-input` and QuickAddBar's inline-expand behavior. New `AddMenu` popover component in the sidebar (File/Paste/Task order, "capture" bias) and Focus toolbar (Task/File/Paste order, "task" bias); each option deep-links to `/add?mode=X` to skip the picker. File/Paste routes go through the existing `ai-parse-input` → proposals pipeline (preserves source context for multi-item drops); Task goes directly to item creation. Deleted `ReviewInput.tsx`; `useReviewInputs` hook retained and reused by the File/Paste lanes.
- **2026-04-18**: Prompt caching enabled on `ai-parse-transcript` and `ai-parse-input`. Prompts split into a stable `system` block (extraction philosophy, strict criteria, output schema, `userDisplayName`) marked with `cache_control: {type: "ephemeral"}`, and a per-call `user` message (meeting date, attendees, user bio, items summary, transcript). Expected ~90% cost reduction on the instruction prefix after the first call in each 5-min window. Cache-usage fields (`cache_read_input_tokens`, `cache_creation_input_tokens`) logged per request for monitoring. Note: `ai-parse-input`'s system prompt is currently ~3K tokens, below Opus 4.6's 4096-token minimum — caching structure is in place but won't fire until the prompt grows.
- **2026-04-18**: Durable AI call telemetry. New `ai_call_telemetry` table (migration `20260418000000`) records one row per Claude API call with per-model token breakdown (input/output/cache read/cache write), stop reason, latency, and source linkage. Shared helper `supabase/functions/_shared/telemetry.ts` exposes `recordAiCall()` — wired into `ai-parse-transcript` and `ai-parse-input` (remaining AI functions are a follow-up). New page at `/settings/analytics/ai-calls` shows the last 200 calls with estimated cost, cache hit rate, and cached-vs-uncached savings. RLS restricts reads to the row owner. Motivation: Supabase's Management API log retention is too sparse to see cache behavior; this is durable and queryable from the app.
- **2026-04-18**: Cache-backed identity resolver. `supabase/functions/_shared/resolve-identity.ts` rewritten as a stateful resolver (`createIdentityResolver`) that preloads people + companies once per request and serves lookups from an in-memory index. `resolveAttendees` now dedups, classifies in memory, and bulk-inserts new people in a single round trip. `ai-parse-transcript` historical mode instantiates one resolver per request and reuses it across participant/commitment/idea resolves. Free-function exports preserved for backward compat. Motivation: a single parse was generating 400+ `/rest/v1/people` calls (each with two full-table alias scans); now runs in ~2 queries + bulk-insert.
- **2026-04-18**: `scripts/deploy-functions.sh` + `npm run deploy:functions`. Bakes in `--no-verify-jwt` on every deploy so external webhooks (Power Automate → calendar-sync, Jamie → jamie-webhook) don't get 401'd by the gateway before the function runs. Replaces direct `supabase functions deploy` usage in CLAUDE.md.
- **2026-04-18**: Context Bundles — queryable event briefing packs. New `bundles` primitive (6 tables: `bundles`, `bundle_documents`, `bundle_chunks` with pgvector 1024-dim embeddings, `bundle_entities`, `bundle_gaps`, `bundle_reports`; migration `20260418020000`). Three edge functions: `ai-bundle-ingest` (Opus 4.7 entity extraction + Voyage `voyage-3-large` embeddings, section-based chunking preserving `section_path` for citations), `ai-bundle-report` (Opus 4.7 synthesized plane-reading narrative, stored in `bundle_reports`, regenerable), `ai-bundle-chat` (Opus 4.7, hybrid retrieval pgvector+FTS, tool calls reaching into Resurface: `lookup_person_in_resurface`, `lookup_company_in_resurface`, `list_bundle_subjects`, `search_resurface_transcripts`). Frontend: `/events` list + `/events/:id` detail with three-tab layout (Report/Query/Source), no sidebar, mobile-first (`BundleLayout`). Report persisted to localStorage for offline plane reading; service worker added for app shell caching. `chat_messages.scope_type` extended to include `'bundle'`. Sidebar gains "Events" nav entry.
- **2026-04-18**: Memory extraction engaged. Every parser run (active + historical) now emits a `memories[]` array of durable facts about people/companies/preferences; the edge function inserts them directly into the `memories` table with `source='extracted_from_transcript'` (no proposal-queue round trip, per design). Existing memories are passed into the prompt as a "do not re-emit" list, and the insert helper case-insensitively dedupes against the table as a safety belt. Settings page gains a manual "add memory" input that writes with `source='user_added'`. The `memories` block was already being injected into every AI call via `buildUserContext`, so the loop is now closed — every future AI call starts with accumulated context instead of cold.
- **2026-04-23**: Auto-suggest pursuit links for parsed meetings. New `pursuit_link_proposals` table (migration `20260423000000`) holds AI-suggested {meeting → pursuit} matches as pending review items. `ai-parse-transcript` now runs a two-stage matcher after proposal insertion: (1) deterministic pre-filter scoring each active pursuit on company match, pursuit-name mentions in the transcript, and attendee email-domain overlap; (2) if any candidate passes, Claude (Sonnet 4.6) picks at most one from the shortlist with reasoning + confidence ≥ 0.7. A single strong deterministic match (score ≥ 3, clear winner) skips the LLM call entirely. Never auto-applied; user accepts on `/proposals` via a new `PursuitLinkSuggestion` banner. Accept inserts a `pursuit_members` row with `member_type='meeting'` — the infrastructure for meeting↔pursuit linkage has existed since the pursuits migration but was manual-only until now.
- **2026-04-23**: Backfill for historical meetings. Matcher extracted into `supabase/functions/_shared/pursuit-matcher.ts`; new `backfill-pursuit-links` edge function sweeps active-mode meetings (`transcript_summary is not null`) and runs the matcher per meeting, creating pending proposals without re-parsing transcripts. Idempotent (skips already-linked and already-proposed pairs via the unique constraint). Triggered from a new "Match past meetings" button on `/pursuits`. Accepts optional `since` and `limit` body params for scoped runs.
- **2026-04-23**: Focus staleness gated by due-date horizon. `compute-staleness` now dampens the time-decay component (`baseDecay * log₂(hoursSinceTouch)`) when an item's `due_date` is far out: ×0.3 for 15–30 days, ×0 for 30+ days. Stakes contribute at full weight regardless so a high-stakes future item can still surface — but medium-stakes items scheduled for a month out no longer drift into Focus via time-decay alone. Deadline urgency ramp widened to match: overdue=100, ≤24h=75, ≤72h=50, ≤7d=25, ≤14d=10 (previously capped at 72h). Frontend's `computePriority` due-component ramp extended to 14 days in `src/lib/priorityScore.ts`, and the reverse-engineered "Nd stale" chip tracks the same bands. Rationale: "staleness" means neglected present work, not scheduled future work — an item due in 5 weeks isn't stale, it's on schedule.
- **2026-04-24**: Batch email ingestion with pre-synthesis triage. New `/add` File mode accepts multi-file drops (up to dozens of `.eml` at once). Each file creates an `inputs` row, then one batched Sonnet call (`ai-catalog-batch` edge function) classifies all of them at once: actionable/skip with a short reason, plus optional thread_group_id for detected reply chains. Skipped inputs get marked with `triage_result='skipped'` and never generate proposals — skipping the expensive per-input synthesis. Actionable inputs fire `ai-parse-input` in the background via `EdgeRuntime.waitUntil` so the response returns immediately. Migration `20260424000000` adds `triage_result`, `triage_reason`, `thread_group_id` to `inputs`. New UI: staged-file list with per-file remove on `/add`, post-batch result banner, and a collapsed "Skipped by triage" section on `/proposals` with a "Process anyway" override per row (flips the decision and fires full synthesis). Screenshots bypass the catalog step (no text to pre-filter) and go straight to synthesis. Rationale: dropping "the day's emails" (~30-50 at a time) would waste most Claude calls on FYI replies and confirmations if every file got full-synthesis treatment; one batched triage call at Sonnet prices filters the signal from the noise.
- **2026-04-29**: Follow-ups — post-meeting relational closing moves as a first-class entity, distinct from commitments and tasks. New `follow_ups` table (migration `20260429000000`) with jsonb `recipients[]` (each with `name`, `email`, `person_id`, `draft_subject`, `draft_body`, `rationale`, `sent_at`), status (`pending`/`sent`/`dismissed`), `source_meeting_id` FK, evidence text, AI confidence. `ai-parse-transcript` extended (active mode only) to extract follow-up suggestions: AI judges whether the meeting warrants one (most external meetings yes, internal standups no), picks recipient(s) from attendees, drafts per-recipient body with rationale. Writes directly to `follow_ups` (status=`pending`), no proposal-queue round trip — mirrors the memories pattern. Persists indefinitely; never auto-expires. New `/follow-ups` route groups pending by age bucket (Today / Yesterday / Earlier this week / Older) with no visual fading — the bucket header carries the lateness signal. Per-recipient send button copies the draft body to clipboard and stamps that recipient's `sent_at`; the follow-up rolls up to status=`sent` when every recipient is stamped. Dismiss closes the whole thing. New section on `/meetings/:id` shows the meeting's own follow-up inline. Sidebar gains "Follow Ups" entry next to Proposals. New `useFollowUps` hook + `FollowUpCard` component. Rationale: follow-ups fail not because of forgetting but because of depletion after back-to-back meetings; AI removes the cognitive cost of composing them so the relational layer doesn't drop when the day gets busy.
- **2026-04-24**: Editorial typography pass + parallel `/focus-v2` view. Loaded **Inter** (sans) and **JetBrains Mono** (monospace) via Google Fonts; wired `--font-sans` and `--font-mono` in `src/index.css` so every `font-sans`/`font-mono` utility inherits the new stack. `StatusBadge` retired the filled `bg-X-900/40` pattern in favor of outlined, uppercase, monospace chips with text/border color matching — the chip system used throughout the new view. Sidebar stripped of per-row icons (navigation is text-first now); wordmark gets a small monospace timestamp underneath (`FRI · APR 24 · 9:12A`); user email at the bottom also rendered in mono. New page `FocusV2.tsx` at route `/focus-v2` (sidebar entry "Today v2") shares `useItems` + `sortByPriority` with current Focus but renders as an editorial vertical list: large title, one-line monospace meta (stream dot + name + relative due), single right-side narrative chip ("Overdue" / "Due Today" / "Nd Stale" / "High Stakes" / "Pinned" / "Waiting") chosen by a deterministic priority cascade. Reserved red for OVERDUE alone — cyan carries every other signal so the one alert color actually alerts. Current `/focus` left untouched for A/B comparison; once the new view earns the default, the old can be retired. Rationale: shifts the app from "priority list" to "today's agenda of your work life" without touching data or ranking logic.
- **2026-04-29**: Follow-up iteration based on real-use feedback. **Writing rules** baked into the parser prompt to suppress AI tells: no em dashes, no colon-punchlines ("Here's the thing: it works"), no "it's not just X, it's Y", no triadic rhetorical lists, blocklist of giveaway words (`delve`, `leverage`, `robust`, `seamless`, `navigate` as a verb, `ensure`, `moreover`). Positive instruction: write the way Dustin would actually type a quick email after a meeting. Default signoff changed from "Best," to "Regards,". Two new instructions: acknowledge gaps honestly ("I went looking but couldn't find it on my side, could you send it over?" rather than pretending) and include one explicit ask when the meeting surfaces a real need from the recipient. **One email = one follow-up row** schema rework (migration `20260429010000`). `draft_subject` and `draft_body` move up to the row; `recipients[]` simplifies to a To list (`name`, `email`, `person_id`, `rationale`). Per-recipient drafts are gone — they didn't match the user's actual style of greeting everyone in one email ("Hey Justin, Dyana, and Sean,") or "Hey All," for 4+. Parser greeting-style guidance updated to match. Clipboard fix: copy button copies the body only, no `To:` / `Subject:` header lines that were trash to delete when pasting into a reply. New MCP tool `list_follow_ups` (mcp-server) so the agent can query by status, scope to a meeting, and get the source meeting title hydrated inline.
- **2026-04-30**: Morning briefing pre-warm + date preview. (a) New migration `20260430010000_morning_briefing_cron.sql` schedules `generate-morning-briefing` at 10:00 UTC and 11:00 UTC daily — covers 6am Eastern year-round (EDT and EST). Second call is essentially free; the function returns the existing snapshot if one exists for today. So when Dustin opens the page on his phone at 6am, the briefing is already generated and the page is instant. (b) Edge function gains an optional `for_date: "YYYY-MM-DD"` body param, threaded through the page via `?date=YYYY-MM-DD` URL param. Lets you preview tomorrow's briefing now (or any date — handy for testing without waiting for tomorrow). The page shows a small banner when in preview mode. (c) Edge function relaxed to allow unauthenticated calls (matches existing `compute-staleness` and `retry-unprocessed` patterns) so cron doesn't need to manage credentials; falls back to `RESURFACE_DEFAULT_USER_ID` when no JWT. (d) Email permanently removed from the deferred-work list — Dustin confirmed he doesn't want any email channel; the page is the channel.
- **2026-04-30**: Morning briefing — daily snapshot at `/morning`, mobile-first and light-themed (dark theme everywhere else but the morning ritual reads on a phone, often before sunrise — white-on-black is harsh). New `morning_briefings` table (migration `20260430000000`) with one row per user per date and jsonb sections for meetings/follow-ups/commitments/tasks plus an AI-synthesized intro paragraph. New Edge Function `generate-morning-briefing` (Sonnet 4.6) pulls today's calendar with per-meeting attendee context (people lookup, company, open commitments to/from), pending follow-ups, outgoing commitments overdue or due today, and today's surfaced task list (overdue / due today / pinned / critical staleness / high stakes). AI generates only the 60-second intro paragraph; everything else is deterministic and saved as jsonb so the page renders without further synthesis. Snapshot semantics: first call of the day generates and persists, subsequent calls return the same data, manual "Refresh" button regenerates. No cron yet — on-demand generation keeps compute predictable (the user said "if they change every minute, that could be a lot of computer"). New `useMorningBriefing` hook + `Morning` page; sidebar entry "Morning" right under Dashboard. PWA tightening + 6am cron pre-warming + email backup all deferred for follow-on iterations.
- **2026-04-30**: Three smaller ships and skill tooling. (a) **"Already Done" button on task proposals**: end-of-day triage problem — by the time you review proposals, you've already done some of the work. "Not actionable" is wrong (it WAS actionable, just complete) and dismissing loses history. New button accepts the proposal AND creates the item with `status='done'` + `completed_at=now()` in one click. Activity log records `created_done` so the path is distinguishable from a normal accept. Only shown when `acceptAs='task'` (commitments have their own met/broken states). (b) **Follow-up parser default flipped to GENERATE for any external attendee.** Diagnosed today: zero follow-ups generated for that morning's external meetings (Orange Logic, Shane Intro, Principal Financial — all 1:1 client/partner calls that clearly warranted one). The "Extract ONLY if warrants" framing was making the model lean cautious on edge cases. Flipped to "DEFAULT YES whenever ANY external attendee is present" with explicit skip cases (all-internal, routine standup, <5min transactional). After re-parse: all three now have follow-ups; genuinely-internal meetings still correctly skip. (c) **CLAUDE.md "Required Skill Invocations" section.** Auto-trigger rules for two Claude Code skills: `claude-api` whenever editing parser/Edge Function prompt structure (cache hygiene), and `security-review` before any push touching auth/RLS/PII paths. (d) **Two project-level skills** under `.claude/skills/`: `resurface-iterate-prompt` (one command for deploy + reparse + per-meeting summary with delta vs prior run) and `resurface-ship-feature` (pre-flight checks + ordered ship: `supabase db push` → `npm run deploy:functions` → `git push`). Both replace inline curl/JWT/python boilerplate that was repeating across iterations. Per-skill `.history/` directory gitignored.
