-- Morning briefings: one snapshot per user per date.
--
-- The morning ritual surface. Generated on-demand the first time the user
-- visits /morning each day; persisted so subsequent views are instant and
-- the briefing doesn't change throughout the day (snapshot semantics --
-- the user wants "where things stand at 6am" not a live dashboard).
--
-- The AI does synthesis (one short intro paragraph). The structured data
-- lives in jsonb fields and is rendered deterministically by the frontend.
-- This keeps per-generation token cost low and makes the data self-contained
-- (no joins required for read).
--
-- Cron pre-warming is deferred for v0; the unique (user_id, briefing_date)
-- constraint makes adding cron later safe (insert-or-skip).

create table morning_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,

  -- The date the briefing represents (in the user's local timezone).
  -- The snapshot is keyed off this, not generated_at.
  briefing_date date not null,

  generated_at timestamptz not null default now(),

  -- AI-synthesized 60-second intro paragraph. May be null while
  -- status='generating' or if generation failed.
  intro_text text,

  -- Structured per-section data. Rendered as-is by the frontend.
  --
  -- meetings_data shape:
  --   [{ id, title, start_time, end_time, attendees: [name],
  --      attendee_context: [{ name, person_id, company, last_seen_meeting_date,
  --                            open_commitments: [{ id, title, direction, do_by }] }],
  --      pursuit: { id, name, color } | null,
  --      prior_summary: "one-line context if this is a recurring meeting" }]
  meetings_data jsonb not null default '[]'::jsonb,

  -- follow_ups_data shape:
  --   [{ id, source_meeting_id, source_meeting_title, draft_subject,
  --      recipients: [name], age_days }]
  follow_ups_data jsonb not null default '[]'::jsonb,

  -- commitments_data shape (outgoing only, overdue + due today):
  --   [{ id, title, counterpart, company, do_by, days_overdue }]
  commitments_data jsonb not null default '[]'::jsonb,

  -- tasks_data shape (due today, overdue, pinned, or critical staleness):
  --   [{ id, title, due_date, status, stakes, staleness_score, pinned,
  --      surface_reason: "due today" | "overdue" | "high stakes" | "stale" | "pinned" }]
  tasks_data jsonb not null default '[]'::jsonb,

  -- Generation state. 'generating' is short-lived; the frontend polls until
  -- ready. 'failed' shows an error inline with a Regenerate button.
  status text not null default 'generating' check (status in (
    'generating', 'ready', 'failed'
  )),
  error_text text,

  -- Telemetry on the AI synthesis call. Read by /settings/analytics/ai-calls.
  ai_model text,
  ai_input_tokens int default 0,
  ai_output_tokens int default 0,
  ai_cache_read_tokens int default 0,
  ai_latency_ms int,

  -- One snapshot per user per date.
  unique (user_id, briefing_date)
);

create index idx_morning_briefings_user_date
  on morning_briefings(user_id, briefing_date desc);

alter table morning_briefings enable row level security;

create policy "Users can manage own briefings"
  on morning_briefings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter publication supabase_realtime add table morning_briefings;
