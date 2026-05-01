# Utility Suite — Build Plan

A handoff document for an executor AI to implement the next round of analytical surfaces on top of the existing Resurface corpus. Read top-to-bottom and execute in order. Each phase has acceptance criteria; do not move on until they pass.

The work here exploits data **already in the database** (meetings, people, companies, ideas, memories, commitments, follow-ups, items, streams, junction tables). No new ingestion sources. No new models to call (one optional embedder for Phase 6).

---

## 0. Operating assumptions

These are decisions already made. Do **not** revisit them. If something seems wrong, ask before changing it.

- **Stack**: React 19 + Vite + TypeScript, TanStack Query, React Router 7, Tailwind v4 (dark theme, follow existing visual language). Supabase Postgres + Edge Functions (Deno). pgvector is already enabled. Voyage AI key is in Supabase Edge Function secrets (`VOYAGE_API_KEY`).
- **Single-user app**: `RESURFACE_DEFAULT_USER_ID` is set; all queries filter by `user_id = auth.uid()` via RLS. New tables enable RLS + policy + grant to `authenticated`. New SECURITY DEFINER functions follow the pattern in `supabase/migrations/20260501020000_search_rpc_auth_guards.sql` (reject non-service-role calls passing someone else's user id).
- **Sidebar pattern**: a new "Utility" collapsible group mirrors the existing "Directory" group in `src/components/Layout.tsx`. Same visual treatment, same expand/collapse, same NavLink styling.
- **Page wrapper**: utility pages live under `src/pages/utility/*.tsx`, route prefix `/utility/<name>`. Each page is wrapped in `<div className="mx-auto max-w-3xl">…</div>` for consistency.
- **Hook pattern**: data fetching is TanStack Query, files in `src/hooks/`. Keep query keys simple and namespaced (e.g. `['utility', 'prebriefs']`).
- **Edge Function deploy**: always via `npm run deploy:functions -- <name>` (the wrapper script bakes in `--no-verify-jwt`).
- **Migrations**: place in `supabase/migrations/` with timestamp `YYYYMMDDHHMMSS_description.sql`. Use a NEW timestamp for each migration; don't reuse.
- **Commits**: small, focused, one phase per commit. Use the project's commit-message style: subject line in imperative mood, body explains *why* before *what*. Co-authored trailer with Claude.
- **Build verification**: every phase must pass `npm run build` cleanly before commit.
- **Out of scope** for this plan: changing existing pages other than the sidebar and `/companies/:id`; introducing new third-party libraries; redesigning the visual system.

---

## 1. Phase 1 — Scaffolding

**Goal**: a new "Utility" group appears in the sidebar with four entries, each pointing to a placeholder page that says "Coming soon." The framework is in place; the surfaces are stubs.

### Files to create

```
src/pages/utility/PreBriefs.tsx
src/pages/utility/Momentum.tsx
src/pages/utility/Quiet.tsx
src/pages/utility/Similar.tsx
```

Each file follows this exact shape (replace `PreBriefs` and `"Pre-Briefs"` per file):

```tsx
export default function PreBriefs() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-semibold text-white">Pre-Briefs</h1>
      <p className="text-sm text-gray-500">Coming soon.</p>
    </div>
  )
}
```

### Files to edit

**`src/App.tsx`** — add imports and four routes under the `<Route path="/" element={<Layout />}>` block, beside the existing `/themes` route:

```tsx
import PreBriefs from './pages/utility/PreBriefs'
import Momentum from './pages/utility/Momentum'
import Quiet from './pages/utility/Quiet'
import Similar from './pages/utility/Similar'

// inside the Routes:
<Route path="utility/prebriefs" element={<PreBriefs />} />
<Route path="utility/momentum" element={<Momentum />} />
<Route path="utility/quiet" element={<Quiet />} />
<Route path="utility/similar" element={<Similar />} />
```

**`src/components/Layout.tsx`** —
1. Add a `utilityItems` array near `directoryItems`:
   ```tsx
   const utilityItems = [
     { to: '/utility/prebriefs', label: 'Pre-Briefs' },
     { to: '/utility/momentum', label: 'Momentum' },
     { to: '/utility/quiet', label: 'Going Quiet' },
     { to: '/utility/similar', label: 'Similar' },
   ]
   ```
2. Add a `utilityOpen` `useState(false)` next to `directoryOpen`.
3. Mirror the entire "Directory — collapsible section" block (around line 210) for Utility, immediately after Directory in the JSX. Same border-top, same chevron, same NavLink list structure. Label the section heading "Utility".

### Acceptance

- `npm run build` passes.
- App loads. Sidebar shows a new "Utility" header below "Directory". Click it expands to four entries. Click each entry, route navigates and shows "Coming soon."
- No other behavior changes.

### Commit

```
Utility: scaffold sidebar group with four placeholder pages

A new collapsible "Utility" sidebar section, mirroring the Directory
group's pattern. Routes: /utility/prebriefs, /utility/momentum,
/utility/quiet, /utility/similar. All four pages are stubs that say
"Coming soon" — content lands in subsequent phases.
```

---

## 2. Phase 2 — Pre-Briefs

**Goal**: For every meeting in the next 7 days, surface a pre-brief panel showing what context the user already has on the attendees of that meeting (open commitments, recent memories, recent ideas, prior meetings with the same people).

**No schema changes**. Pure SQL across existing tables.

### What "context" means here, concretely

For one upcoming meeting `M`:

1. **Resolved attendees** — `meetings.attendees` is a `text[]`. Resolve each entry to a `people` row via the canonical identity layer:
   - First try exact email match: `lower(people.email) = lower(attendee_string)`.
   - If no match and the attendee string is an email, try `lower(attendee_string) = ANY(lower(people.aliases))`.
   - If still no match, leave it as a "name only" attendee (display only, no joins downstream).
2. **Per-attendee context** for each resolved attendee:
   - Open commitments where `counterpart` matches that person's name OR `counterpart ILIKE` person's name AND `status` IN (`'open'`, `'waiting'`).
   - Memories whose `content ILIKE %person.name%` — coarse but cheap; refine later if needed.
   - Ideas where `originated_by` matches person's name.
   - Recent prior meetings (last 60 days) where the same person was an attendee. Sort desc, top 5.
3. **Per-meeting context** (across all attendees):
   - The company most strongly represented in attendee company_ids (mode of attendees' company_ids). Used to pull company-level open ideas/commitments.

### Backend

Create one Edge Function: **`supabase/functions/get-prebriefs/index.ts`**.

It takes no body. Returns an array of pre-brief objects, one per upcoming meeting in the next 7 days, sorted by `start_time` asc.

Shape:

```ts
interface PreBrief {
  meeting: {
    id: string
    title: string
    start_time: string
    location: string | null
    attendees_raw: string[]
  }
  attendees: Array<{
    raw: string
    person_id: string | null
    name: string
    company_id: string | null
    company_name: string | null
    open_commitments: Array<{ id: string; title: string; do_by: string | null; status: string }>
    recent_memories: Array<{ id: string; content: string; created_at: string }>  // top 3
    recent_ideas: Array<{ id: string; title: string; created_at: string }>       // top 3
    prior_meetings: Array<{ id: string; title: string; start_time: string }>     // top 5
  }>
  primary_company: {
    id: string
    name: string
    open_company_ideas: Array<{ id: string; title: string }>     // top 5
    open_company_commitments: Array<{ id: string; title: string; status: string }>  // top 5
  } | null
}
```

Implementation notes:
- Auth pattern: copy from `supabase/functions/ai-analyze-themes/index.ts` (accept JWT or service-role).
- Use the `admin` client throughout once user_id is resolved.
- Limit upcoming meetings to 20 (nobody scrolls more than that).
- Use `Promise.all` to parallelize per-attendee subqueries within a meeting; sequential between meetings is fine.
- Cap memory/idea/prior-meeting counts as shown in the shape.

### Frontend

**`src/hooks/usePreBriefs.ts`** — new hook calling the Edge Function:

```ts
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface PreBrief { /* mirror the backend shape exactly */ }

export function usePreBriefs() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['utility', 'prebriefs'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not authenticated')
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-prebriefs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({}),
        },
      )
      if (!resp.ok) throw new Error(`Pre-briefs failed (${resp.status})`)
      return (await resp.json()) as PreBrief[]
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,  // refetch at most every 5 minutes
  })
}
```

**`src/pages/utility/PreBriefs.tsx`** — replace the stub with the real page. Render one card per upcoming meeting. Each card shows: meeting title, start_time, attendees with their context blocks beneath. Use existing visual idioms (rounded-lg border-gray-800 bg-gray-900, etc., consistent with `/themes` and `/meetings`).

Card layout suggestion (you have license to adjust details):

```
┌─────────────────────────────────────────────────────┐
│ Mon May 4 · 2:00 PM        [meeting title]          │
│                                                     │
│ ▸ Adam LaPorta (Orange Logic)                       │
│     Open: certification roadmap (do_by May 15)      │
│     Last said: "If 4 of these drop in my lap..."    │
│     5 prior meetings · last Apr 30                  │
│                                                     │
│ ▸ Linda Sasso (EPAM)                                │
│     2 open commitments · 3 prior meetings           │
└─────────────────────────────────────────────────────┘
```

If a meeting has zero context across all attendees, render the card with a quiet "(no prior context)" line — don't hide it.

### Acceptance

- Visit `/utility/prebriefs`. Page loads in under 3s for ~20 upcoming meetings.
- Each meeting card shows its attendees, even if their context is empty.
- Resolved-to-person attendees show real prior commitments, memories, ideas, prior meetings, where they exist in the database.
- Unresolved attendees (raw email or name with no `people` row) show as "name only" with no context block.
- `npm run build` passes. No console errors on the page.
- Edge function deploys cleanly and returns a valid response when called by hand with `curl` against the Supabase URL.

### Commit

```
Pre-Briefs: surface meeting context for the next 7 days
```

---

## 3. Phase 3 — Going Quiet (dropout detection)

**Goal**: A page listing **threads that have gone silent**. A "thread" can be a person, a company, an account, an idea, or a topic. Activity is measured by mentions across the corpus over time. The query is: items that were active 30–90 days ago (≥3 mentions in that window) and have had ZERO mentions in the last 30 days.

**No schema changes** beyond an optional materialized view (described below).

### Strategy

Compute mentions per (entity_type, entity_id, week) on the fly via a single SECURITY DEFINER Postgres function. Don't materialize unless query latency is a problem.

For v1 do **two entity types only**: `person` and `company`. Topics and ideas can come later — they need a fuzzy text-matching layer that's a separate feature.

A `person` is "mentioned" in any of:
- A meeting they attended (`meetings.start_time` joined through `meeting_attendees`).
- An idea where `originated_by` matches their name.
- A commitment where `counterpart` matches their name.
- A memory whose `content ILIKE %name%`.

A `company` is "mentioned" in any of:
- A meeting where the primary attendee company is theirs.
- An idea with `company_id` matching, or `company_name ILIKE` company name.
- A commitment with `company` matching.

Use the latest mention timestamp per entity. The page surfaces entities where the latest is between 30 and 90 days old AND there were ≥3 mentions in that window.

### Backend

Create migration **`supabase/migrations/<ts>_quiet_threads_rpc.sql`**:

```sql
-- get_quiet_threads(searching_user_id uuid, silent_days int default 30,
--                  active_window_days int default 60, min_mentions int default 3)
-- returns one row per entity that's gone quiet.

create or replace function get_quiet_threads(
  searching_user_id uuid,
  silent_days int default 30,
  active_window_days int default 60,
  min_mentions int default 3
)
returns table (
  entity_type text,
  entity_id uuid,
  entity_name text,
  last_mention_at timestamptz,
  prior_mention_count int,
  days_silent int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and auth.uid() is distinct from searching_user_id then
    raise exception 'forbidden';
  end if;

  return query
  -- Implement two CTEs: person_mentions and company_mentions, each
  -- producing (entity_id, mentioned_at) rows.
  -- Then aggregate to (entity_id, last, count_in_active_window).
  -- Filter to last < now() - silent_days AND count >= min_mentions.
  -- Join to people / companies for the display name.
  ...;
end;
$$;

revoke all on function get_quiet_threads(uuid, int, int, int) from public;
grant execute on function get_quiet_threads(uuid, int, int, int) to authenticated, service_role;
```

Fill in the CTE implementation. Use `UNION ALL` to combine the four mention sources per person, three per company. Be conservative on the `ILIKE` joins — pre-index on `lower()` if needed.

Apply the migration with `supabase db push`.

### Frontend

**`src/hooks/useQuietThreads.ts`** — query the RPC:

```ts
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface QuietThread {
  entity_type: 'person' | 'company'
  entity_id: string
  entity_name: string
  last_mention_at: string
  prior_mention_count: number
  days_silent: number
}

export function useQuietThreads() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['utility', 'quiet'],
    queryFn: async () => {
      if (!user) return []
      const { data, error } = await supabase.rpc('get_quiet_threads', {
        searching_user_id: user.id,
      })
      if (error) throw error
      return (data ?? []) as QuietThread[]
    },
    enabled: !!user,
  })
}
```

**`src/pages/utility/Quiet.tsx`** — render two columns or two sections (People / Companies). Each row: name, "X days silent", "N prior mentions in active window", linked to the entity's existing detail page (`/people/:id`, `/companies/:id`). Sort by days_silent desc within each section.

### Acceptance

- `/utility/quiet` loads. Page returns within 1.5s.
- Threads listed are real (verify by clicking one and confirming the underlying activity matches).
- Empty state ("Nothing has gone quiet — all your active threads have recent activity.") renders if the result is empty.
- Build passes.

### Commit

```
Going Quiet: surface threads (people, companies) that have dropped off
```

---

## 4. Phase 4 — Momentum (sparklines)

**Goal**: A single page showing weekly mention sparklines for the top N entities in the corpus. Same entity logic as Phase 3 (people, companies). The sparkline shows the past 12 weeks; weeks are buckets, value is mention count.

### Backend

Create migration **`supabase/migrations/<ts>_entity_mentions_view.sql`** — a regular VIEW (not materialized; the corpus is small enough):

```sql
create or replace view entity_weekly_mentions as
-- Reuse the same UNION ALL mention logic from get_quiet_threads,
-- but bucket to date_trunc('week', mentioned_at) and group_by
-- (user_id, entity_type, entity_id, week_start) with count(*).
...;

-- Keep RLS by exposing only via a SECURITY DEFINER RPC, not the view directly.
```

Add an RPC `get_entity_momentum(searching_user_id uuid, weeks int default 12, top_n int default 30)` that returns rows pre-pivoted: one row per entity with a JSON array of weekly counts, sorted by total mentions in the window.

```sql
create or replace function get_entity_momentum(
  searching_user_id uuid,
  weeks int default 12,
  top_n int default 30
)
returns table (
  entity_type text,
  entity_id uuid,
  entity_name text,
  total_mentions int,
  weekly_counts int[]  -- length = weeks, oldest first
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and auth.uid() is distinct from searching_user_id then
    raise exception 'forbidden';
  end if;
  -- ...
end;
$$;
```

### Frontend

**`src/hooks/useEntityMomentum.ts`** — same pattern as Phase 3.

**`src/components/Sparkline.tsx`** — small, dependency-free SVG sparkline component:

```tsx
interface Props {
  values: number[]
  width?: number
  height?: number
  className?: string
}

export default function Sparkline({ values, width = 120, height = 24, className }: Props) {
  if (values.length === 0) return null
  const max = Math.max(...values, 1)
  const dx = width / Math.max(values.length - 1, 1)
  const points = values
    .map((v, i) => `${(i * dx).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={width} height={height} className={className}>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
```

**`src/pages/utility/Momentum.tsx`** — table with rows: entity name | sparkline | total | trend arrow (up if last 4 weeks > prior 4 weeks, down if reversed, flat otherwise). Filter buttons: All / People / Companies. Default sort: total mentions desc.

### Acceptance

- `/utility/momentum` loads. Sparklines render and visibly differentiate trends (a flat line for steady, an upward curve for accelerating, a tail-off for cooling).
- Filter buttons toggle between People / Companies / All.
- Each row click goes to the entity's detail page.
- Build passes.

### Commit

```
Momentum: weekly-mention sparklines for top people and companies
```

---

## 5. Phase 5 — Account One-Pagers

**Goal**: Extend the existing `/companies/:id` page with a top-of-page rollup that aggregates everything related to that company in one view: people you know there, recent meetings, open commitments, surfaced ideas, momentum sparkline. Existing tabs/sections on the page stay intact.

This is **not** a new route. It's an additive section at the top of `src/pages/CompanyDetail.tsx`.

### Backend

Add one RPC, `get_company_rollup(company_id uuid, searching_user_id uuid)`, in a new migration. Returns a single row with jsonb fields:

```sql
create or replace function get_company_rollup(
  company_id uuid,
  searching_user_id uuid
)
returns table (
  people_count int,
  open_commitments_count int,
  open_ideas_count int,
  recent_meetings jsonb,        -- last 5 meetings touching this company
  open_commitments jsonb,       -- top 10 by do_by/created_at
  surfaced_ideas jsonb,         -- top 10 by created_at
  weekly_momentum int[]         -- 12-week counts from get_entity_momentum logic
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
...
$$;
```

### Frontend

**`src/hooks/useCompanyRollup.ts`** — query the RPC.

**Edit `src/pages/CompanyDetail.tsx`** — at the top of the page (under the company name), add a rollup card. Use a 2-3 column grid: counts + sparkline on the left, the lists (recent meetings / open commitments / surfaced ideas) below or to the right. Each list item links to its detail page.

### Acceptance

- Visit any `/companies/:id`. Above the existing content, the rollup appears with non-zero data for any company you've actually worked with.
- The sparkline matches what Phase 4 shows for the same company.
- Build passes.

### Commit

```
CompanyDetail: add rollup section with counts, lists, momentum
```

---

## 6. Phase 6 — Similar (cross-corpus bridges via embeddings)

**Goal**: Surface "similar items" wherever the user is looking at one — an idea, a memory, a commitment, a meeting summary. The neighbor pool spans **all four** of those tables, so the surface reveals semantic bridges the structured schema doesn't.

This phase has the most pieces. Do them in order.

### Step 6.1 — Migration: add embedding columns

Migration **`<ts>_corpus_embeddings.sql`**:

```sql
-- Voyage voyage-3-large is 1024-dim. We use this single dimension
-- across all four corpus tables so similarity can cross table
-- boundaries via shared vector space.

alter table ideas        add column embedding vector(1024);
alter table memories     add column embedding vector(1024);
alter table commitments  add column embedding vector(1024);
alter table meetings     add column embedding vector(1024);

create index on ideas        using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index on memories     using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index on commitments  using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index on meetings     using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

Apply.

### Step 6.2 — Edge function: embed-text + backfill

Create **`supabase/functions/embed-corpus/index.ts`**.

The function does two things, controlled by request body:

- `{ "mode": "backfill" }` — find rows with `embedding IS NULL` across all four tables (cap at 200 per call), batch-call Voyage's `voyage-3-large` model, write embeddings back. Return counts. Designed to be called repeatedly until "no more rows" is returned.
- `{ "mode": "single", "table": "ideas" | "memories" | "commitments" | "meetings", "id": "uuid" }` — embed one row by id (used for write-time embed via a Postgres trigger or app-side hook).

Voyage API:
```
POST https://api.voyageai.com/v1/embeddings
Authorization: Bearer ${VOYAGE_API_KEY}
{ "model": "voyage-3-large", "input": ["text1", "text2", ...], "input_type": "document" }
```

Response: `{ data: [{ embedding: number[] }, ...] }`.

Text construction per row (concatenate the meaningful text fields):
- ideas: `title + description + evidence_text + context_notes`
- memories: `content`
- commitments: `title + description + evidence_text`
- meetings: `title + transcript_summary` (skip rows where both are null)

Be defensive about null fields. Trim to ~6000 chars per item before embedding (Voyage handles up to 32k but cost scales).

### Step 6.3 — Trigger embed-on-insert

Add a database webhook OR a Postgres trigger that calls `embed-corpus` in `single` mode whenever a row is inserted into one of the four tables and the embedding is null.

Simplest path: create a Postgres `pg_net` HTTP call in an `AFTER INSERT` trigger. Pattern from `supabase/migrations/20260430010000_morning_briefing_cron.sql` — same `net.http_post` mechanic. The trigger fires fire-and-forget; if the embedder is down, the row is just left without an embedding and the next backfill picks it up.

### Step 6.4 — RPC: similar items

Migration **`<ts>_similar_items_rpc.sql`** — `find_similar(source_table text, source_id uuid, searching_user_id uuid, max_results int default 8)`.

Returns up to `max_results` rows from across the four tables, ordered by cosine distance ascending, excluding the source row itself.

Use a UNION query: select from each table where `user_id = searching_user_id AND embedding IS NOT NULL AND id != source_id`, including a `1 - (embedding <=> $vec)` similarity score, then `ORDER BY similarity DESC LIMIT max_results`.

Pass the source row's embedding by first SELECTing it inside the function.

### Step 6.5 — Hook + UI surface

**`src/hooks/useSimilarItems.ts`** — call the RPC.

**`src/components/SimilarPanel.tsx`** — a small panel that takes `(sourceTable, sourceId)` and renders the similar items as a list with: title, source-table chip ("idea" / "memory" / "commitment" / "meeting"), similarity score (e.g. "92% similar"), link to the item's detail page.

Drop the panel into:
- `src/pages/IdeaDetail.tsx` (find or create) — under the existing detail content.
- `src/pages/MeetingDetail.tsx` — beneath the synopsis.
- Memory and commitment detail pages don't currently exist as standalone routes; for v1 skip them. The `/utility/similar` page (Phase 1 stub) becomes a free-form explorer where the user picks any item and sees its neighbors.

**`src/pages/utility/Similar.tsx`** — replace the stub with a search-style explorer:
- A search box that searches across all four tables (use the existing `search_everything` RPC).
- Pick a result; the page below renders that item's similar-items panel.

### Step 6.6 — Run the backfill

After deploy, repeatedly call the `embed-corpus` Edge Function in `backfill` mode (e.g. via a small admin script in `scripts/backfill-embeddings.mjs`) until it returns 0. This is a one-time cost (~$5 in Voyage credits for the existing corpus, depending on size).

### Acceptance

- A new idea/memory/commitment/meeting created via the app gets an embedding within seconds of insertion.
- `/utility/similar`: search "synthetic audiences", pick a result, see ~5-8 similar items spanning multiple tables.
- Idea and meeting detail pages show a "Similar" panel beneath their existing content.
- Build passes.

### Commit per sub-step

Six sub-commits, one per Step 6.X. Last commit ships the Similar route content.

---

## 7. After all phases

- Update `docs/SPEC.md` changelog with one bullet per phase, dated.
- Run `node scripts/refresh-spec.mjs` to bring AUTO sections in sync.
- Verify in production: `/utility/prebriefs` shows real meetings, `/utility/quiet` and `/utility/momentum` return data, `/utility/similar` walks neighbors, `/companies/:id` has the rollup at top.

---

## Sequencing summary

| Phase | Time estimate | Touches | Compute cost |
|-------|--------------|---------|---------------|
| 1. Scaffolding | 1 hour | sidebar, 4 stub pages, App router | none |
| 2. Pre-Briefs | 4 hours | 1 edge function, 1 hook, 1 page | none |
| 3. Going Quiet | 3 hours | 1 migration (RPC), 1 hook, 1 page | none |
| 4. Momentum | 4 hours | 1 migration (RPC + view), 1 hook, 1 page, 1 component | none |
| 5. Account One-Pagers | 3 hours | 1 migration (RPC), 1 hook, edit CompanyDetail | none |
| 6. Similar | 1 day | migrations, edge function, trigger, hook, panel, explorer page | ~$5 one-time backfill, then pennies |
| **Total** | **~3 days** | | **~$5** |

Execute in order. Don't reorder. Phase 6 depends on no others; phase 5 reuses query patterns from phase 3 and 4. Phase 1 is non-negotiable as the first step because all later phases assume the routes exist.
