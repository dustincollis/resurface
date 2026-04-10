# Resurface — Project State Snapshot

> Strategic checkpoint document. Working reference for feature ideation
> and AI-leverage planning.

## What it is

A multi-stream, AI-augmented task management system built around the principle that **the system is your working memory**. If it's not in Resurface, it doesn't exist. Originally built for personal use, schema designed to support multi-tenant later if it becomes a product.

The differentiating premise: **AI is a peer, not a feature**. Tasks don't just store data — they're surfaced, prioritized, broken down, classified, enriched, and explained by AI on an ongoing basis.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  FRONTEND (Vercel)                                              │
│  React 19 + Vite 8 + TypeScript 6                               │
│  Tailwind v4 (dark theme, no light mode yet)                    │
│  TanStack Query (data + cache)                                  │
│  React Router 7                                                 │
│  @dnd-kit (kanban, stream reorder)                              │
│  lucide-react (icons)                                           │
└─────────────────────┬──────────────────────────────────────────┘
                      │ HTTPS + Supabase JS client
                      ▼
┌────────────────────────────────────────────────────────────────┐
│  SUPABASE                                                       │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Postgres 17  │  │ Auth         │  │ Realtime     │          │
│  │ + RLS        │  │ (email/pwd)  │  │ subscriptions│          │
│  │ + pg_trgm    │  └──────────────┘  └──────────────┘          │
│  │ + pg_cron    │                                               │
│  │ + pg_net     │  ┌──────────────────────────────┐            │
│  └──────────────┘  │ Edge Functions (Deno)        │            │
│                    │  • ai-classify                │            │
│                    │  • ai-decompose               │            │
│                    │  • ai-chat (with tool use)    │            │
│                    │  • ai-parse-transcript        │            │
│                    │  • ai-distill-profile         │            │
│                    │  • ai-easy-button             │            │
│                    │  • compute-staleness (cron)   │            │
│                    │  • ics-sync                   │            │
│                    │  • microsoft-oauth-exchange   │            │
│                    │  • microsoft-sync-calendar    │            │
│                    └──────────────┬───────────────┘            │
│                                   │                            │
└───────────────────────────────────┼────────────────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────┐
                    │  Anthropic API              │
                    │  claude-sonnet-4-20250514   │
                    └─────────────────────────────┘

Side channel:
┌────────────────────────────────┐
│  MCP Server (Node, local)      │  ← runs on user's machine,
│  9 tools exposed to Claude     │     gives Claude Desktop / Code
│  Desktop / Claude Code         │     direct read/write to Resurface
└────────────────────────────────┘
```

---

## Data model

**8 tables:**

| Table | Purpose | Notes |
|---|---|---|
| `profiles` | extends auth.users | Stores `settings` JSONB: timezone, working hours/days, bio (raw + AI-distilled), microsoft tokens, ICS URL, notify preferences |
| `streams` | user-defined work categories | name, color, icon, sort_order, archived flag, field_templates JSONB |
| `items` | core task entity | title, description, status, next_action, resistance (1-5), stakes (1-5), staleness_score, due_date, custom_fields JSONB (company lives here), parent_id, source_meeting_id, snoozed_until, **pinned**, search_vector (tsvector) |
| `meetings` | discussions / meetings | title, start_time, attendees, transcript, transcript_summary (markdown), extracted_action_items/decisions/open_questions JSONB, search_vector |
| `item_links` | cross-references | source_item_id, target_item_id, link_type (related/blocks/blocked_by/parent/follow_up) |
| `activity_log` | per-item history | action, details JSONB — created, status_changed, touched, etc. |
| `chat_messages` | AI chat history | role, content, actions_taken JSONB (proposed items, updates, etc.) |
| `memories` | facts AI knows about user | content, source (user_added/extracted_from_chat/etc.) — schema only, no extraction running yet |

**Key relationships:**
- items ↔ streams (many-to-one, nullable)
- items ↔ items (parent_id, self-referential — sub-tasks)
- items ↔ meetings (source_meeting_id — tasks born from discussions)
- items ↔ items (item_links — cross-references)
- chat_messages ↔ profiles
- All tables RLS-protected by user_id

**Search:**
- `search_everything()` Postgres RPC unifies items + meetings via tsvector full-text + pg_trgm fuzzy
- Available via Cmd+K global search and as a tool to the AI chat agent

**Cron:**
- `compute-staleness` runs hourly via pg_cron + pg_net to update staleness scores

---

## Design premises

1. **Externalize everything** — the app is your second brain. Capture before context-switch.
2. **AI suggests, user confirms** — proposals (create item, create stream) require Create button. Updates (status, stream assignment) execute immediately because they're less destructive.
3. **Staleness is first-class** — items decay automatically. Things that haven't been touched surface themselves.
4. **Constrained daily view** — Today's Focus caps at 10 items + pinned items. Rest is browsable but not in your face.
5. **Pin overrides algorithm** — when the system gets it wrong, you manually promote.
6. **Custom fields are schema-flexible** — JSONB on items lets streams define their own field templates without migrations. Company is stored here.
7. **Search is first-class** — full-text + fuzzy from day one. No "I can't find that thing I created last week."
8. **Action-oriented** — every item has a `next_action` (the very next physical step). Suggested moves on the dashboard tell you what to do (Do Now / Break Down / Open).
9. **Discussions are inputs** — meeting transcripts get parsed for action items. AI extracts companies, deadlines, decisions, open questions.
10. **AI is contextual** — every AI call gets your bio, timezone, working hours, current date. No more "what time is it for me" guessing.
11. **Tools, not snapshots** — chat agent has live DB tools, not a frozen snapshot. Can answer questions about any subset of your data.
12. **Hierarchy traversal** — sub-tasks know their parent and siblings. You can navigate up, sideways, down.
13. **Tasks know companies** — every task can have a company/account tag, extracted automatically from transcripts or set manually.
14. **No grey for streams** — color is meaningful. Grey means "not categorized."

---

## Features built

### Auth & foundation
- Email/password auth via Supabase
- RLS on all tables
- Realtime subscriptions for live updates across tabs
- Vercel auto-deploy on push

### Items (tasks)
- Full CRUD with inline editing
- Status flow: open / in_progress / waiting / done / dropped
- Resistance + Stakes (1-5 dot ratings)
- Staleness score (server-computed hourly)
- Touch +1d (snoozes for 24h)
- Pin to Focus (manual override)
- Custom fields JSONB (company lives here)
- Linked tasks (related, blocks, blocked_by, parent, follow_up)
- Sub-tasks (parent_id hierarchy with siblings view)
- Source discussion linkback
- Activity timeline
- Quick-add bar with #stream / due:date parsing
- Inline-editable everything (title, description, next_action, due, custom fields, company)

### Streams
- CRUD with color palette (no grey), icon, field templates
- Drag-to-reorder
- Archive
- Sidebar nav with current stream highlighted
- **Uncategorized** virtual stream (always visible) for items with no stream
- List view + Kanban view (drag between status columns)

### Discussions
- Manual create with date picker (defaults to today)
- Grouped by date, sorted desc
- Delete from list or detail page
- Paste transcript → AI parsing
- Structured synopsis (Overview, Key Topics, Participants, Outcomes)
- Extracted action items, decisions, open questions
- Per-action company extraction
- Per-action suggested due date
- "Tasks from this discussion" backlink section
- Linked tasks list shows status badges
- Microsoft Outlook integration (built, blocked by EPAM admin policy)
- ICS feed fallback for Google Calendar etc.

### Today's Focus dashboard
- Composite priority scoring (staleness + stakes + resistance + due urgency)
- Cluster summary chips at the top (X overdue · X stale · X high stakes)
- Cards with title, next step, notes (truncated), surface reason chips
- Suggested AI move per card (Do Now / Break Down / Open) — equal visual weight
- Expandable cards (action row, full notes, Mark Complete)
- Pin indicator (yellow pin icon) replaces rank for pinned items
- Cap at 10 items + all pinned items
- Snoozed items filtered out (with footer count)
- Easy Win button (picks lowest-resistance task + AI guidance)
- Quick add task button
- Centered max-w-2xl layout

### AI capabilities

| Function | What it does |
|---|---|
| `ai-classify` | item creation triggers classification into stream + custom fields + company + suggested next action |
| `ai-decompose` | break a task into 3-7 sub-tasks with descriptions, next actions, suggested due dates |
| `ai-parse-transcript` | extracts synopsis + action items + decisions + open questions + companies |
| `ai-distill-profile` | turns a long bio into a tight 2-4 sentence factual profile |
| `ai-easy-button` | picks an easy task and provides guidance on knocking it out |
| `ai-chat` (with **tool use**) | 6 read tools (list_tasks, get_task, search_tasks, list_streams, list_companies, get_task_counts), proposed items/streams flow, immediate updates flow |
| `compute-staleness` | hourly cron to update staleness scores |

### Search
- Global Cmd+K search modal
- Full-text + fuzzy via search_everything RPC
- Items and meetings unified
- Highlighted match snippets
- Keyboard navigation

### User context (every AI call sees this)
- Display name + bio (raw + AI-distilled)
- Timezone (configurable, browser-detected default)
- Working hours (start/end)
- Working days (M-F default)
- Today's date + current local time
- Memories (schema ready, extraction not built)

### Integrations
- **MCP server** — 9 tools exposed to Claude Desktop and Claude Code via local stdio process
- **Microsoft Graph OAuth** — built end-to-end (edge functions, callback page, settings UI), blocked at EPAM tenant level
- **ICS feed sync** — works for Google Calendar and other published calendars
- **Vercel** — auto-deploy on push to main
- **PWA manifest** — installable as app on desktop and mobile

### Polish
- Error boundary with reload button
- Onboarding wizard (first-run stream creation)
- Data export (JSON dump of everything)
- Tooltips on jargon (Touch +1d, Resist, Stakes, etc.)
- Activity log with icons per action type
- Snooze + pin support
- Real-time chat message ordering fix
- Mark Complete navigates back

---

## Open items raised, not built

| Item | Why | Difficulty |
|---|---|---|
| **Morning briefing email** | Daily summary of what's on your plate | Medium — needs cron + email service |
| **Cross-task context enrichment** | New tasks auto-search related discussions/items for context | Small — fire-and-forget edge function |
| **Memory extraction** | AI extracts memories from chats/transcripts automatically | Medium — needs another edge function + UI to surface |
| **Light mode** | Spec wanted dark + light, only dark exists | Cosmetic |
| **Performance audit / code split** | Bundle ~620KB, no lazy loading | Small but tedious |
| **Loading state polish** | Inconsistent across pages | Small |
| **Tablet-friendly responsive layout** | Spec wanted, not done | Small |
| **Backfill company on existing tasks** | Existing items don't have company set | Could be a chat agent task |
| **Real Outlook integration** | Blocked by EPAM admin; could pivot to email forwarding or Power Automate | Bigger |

## Excluded by user

- Email forwarding / inbound parsing
- Push notifications
- Today's meetings on dashboard ("won't have meetings to surface")
- Calendar gap awareness for AI scheduling

## Phase 2 (deferred)

- Semantic vector search (pgvector)
- Multi-user / collaboration (schema supports it)

---

# Where AI could go further

Currently AI is used reactively (on user action). It could be used more proactively and analytically.

## Currently AI-powered

1. **Item classification on create** (ai-classify) — pretty effective
2. **Item decomposition** (ai-decompose) — works well, sub-tasks inherit company
3. **Transcript parsing** (ai-parse-transcript) — extracts a lot of structured data
4. **Bio distillation** (ai-distill-profile) — one-shot
5. **Easy Win** (ai-easy-button) — picks task + writes guidance
6. **Chat agent** (ai-chat with tool use) — can answer arbitrary questions about your data
7. **MCP** — same chat capability available from Claude Desktop / Code

## Where AI could matter more

### High leverage (would change daily experience)

1. **Morning briefing** — cron job emails (or shows in-app on first load) a personalized daily plan: "Today you have 2 overdue, 1 due today, here's what I'd tackle first and why. Also, you haven't touched the Adobe deal in 5 days." Could be generated overnight with full DB context. The architectural foundation is there.

2. **Cross-task enrichment on creation** — when you create a task, fire-and-forget edge function that searches related discussions, items, decisions and attaches a "context" block to the task: "Last touched X with Y on Date. Decision was Z. Open question is W." Stored in `custom_fields.ai_context`. Would let you create a quick task and then see all the relevant history a few seconds later.

3. **Memory extraction from chats and transcripts** — every chat conversation and transcript parse could spawn a separate AI call asking "is there anything worth remembering about the user from this?" Extracted memories show in Settings. The schema is ready.

4. **Pattern detection** — weekly cron that looks at activity patterns and surfaces insights: "You've snoozed the proposal task 4 times — maybe break it down?" or "You haven't touched 'Healthcare Solutions' stream in 12 days, want to check in?" or "All your overdue items are in 'Internal Operations' — that stream needs attention."

5. **Smart status suggestions** — if an item hasn't moved in X days but has a clear next_action, AI suggests "Should this be marked as Waiting?" If you've been touching an item every day, AI suggests "Should this become an in_progress active project?"

### Medium leverage

6. **Goal/objective tracking** — currently everything is tactical (tasks). Add a Goals concept: high-level outcomes you're working toward. AI helps map tasks to goals automatically. Weekly check-ins on goal progress.

7. **Voice input** — record a voice memo on mobile (PWA), AI transcribes via Whisper, creates items. Could be HUGE for capturing during commute / between meetings.

8. **Conflict/dependency detection** — AI looks at item titles and notices "These two tasks conflict" or "Task A blocks task B based on next_action wording" — suggests creating links automatically.

9. **Time-of-day intelligence** — even without a calendar, AI knows your working hours. It could track which kinds of tasks you actually finish in the morning vs afternoon and recommend accordingly.

10. **Automatic completion detection** — if you mention finishing something in chat or in a transcript, AI proposes marking related items as done.

### Lower leverage but interesting

11. **Cross-discussion synthesis** — "Show me everything that's happened with Adobe across all my discussions" — AI synthesizes 5 transcripts into a coherent summary. The chat agent could already do this with current tools, but a dedicated UI would surface it.

12. **Auto-tagging beyond company** — extract people, projects, technologies as tags. Could grow into a tag system separate from streams.

13. **Time estimation** — AI estimates how long each task will take based on description complexity + your past patterns. Helps with the Easy Win logic.

14. **Smart digest of activity** — "Here's what you got done this week" weekly review, automatically generated.

15. **Email/Slack integration** — forward emails or Slack messages to a Resurface inbound address, AI turns them into items. (Excluded earlier — flagging in case you reconsider.)

## Recommended next investments

If thinking strategically and aiming for maximum AI leverage with minimum scope creep:

1. **Cross-task enrichment on creation** — small build, immediate "wow" factor every time you create something
2. **Morning briefing** — small build, gives the system a daily presence in your life
3. **Memory extraction** — schema ready, would make the chat agent feel like it's actually learning
4. **Pattern detection (weekly insights)** — medium build, but turns the system into something that proactively talks to you instead of waiting to be asked

Everything else is incremental — useful but not transformative.

---

## Where this is honestly weakest

To balance the bullish view:

1. **Discussion sources are limited** — without a real Outlook integration, you're manually pasting transcripts. The whole "discussions become tasks" loop is gated on you remembering to paste.
2. **No backfill** — every new feature applies forward only. Existing items don't get company tags unless asked the chat agent.
3. **Memories are vapor** — schema is ready but extraction isn't running, so the Memories section in Settings is always empty.
4. **Mobile is basic** — PWA installs but layout isn't optimized for phone screens. Selling this to others would need it.
5. **Single user only** — schema supports multi-user but no UI for sharing/collaborating.
6. **No goal tracking** — everything is task-level. No higher-level "what am I working toward this quarter."
