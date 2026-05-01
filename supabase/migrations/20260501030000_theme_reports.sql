-- Theme reports — on-demand AI analyses of the user's accumulated corpus
-- (ideas + memories + outgoing commitments). Each row is one snapshot,
-- timestamped, kept indefinitely so the user can scroll back through prior
-- analyses to see how thinking has evolved.
--
-- The analysis is open-ended: read the corpus, find what reverberates,
-- name themes, take positions. The schema doesn't constrain the structure
-- of a "theme" much beyond what the renderer needs — most of the content
-- lives in jsonb so we can iterate on the prompt without schema migrations.
--
-- Deliberately NOT including:
--   - report_type filter — for now there's just one analysis. Multi-report
--     types are deferred. When we add them, this column already exists.
--   - prior-report context — each run is independent. Theme decay is
--     handled by recency in the corpus itself, not by carrying past
--     analyses forward. The user wants ideas to come and go organically.

create table theme_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,

  -- The analysis output. Two parallel surfaces:
  --   themes:   strong patterns reverberating across the corpus
  --   one_offs: sharp single signals worth flagging but not yet a theme
  themes jsonb not null default '[]',
  one_offs jsonb not null default '[]',

  -- The AI's framing paragraph — "where you are right now, looking at
  -- everything you've been hearing and thinking about." Optional; the
  -- prompt asks for it but the model can omit if the corpus is too thin.
  intro text,

  -- Metadata for transparency / debugging — what went into the analysis,
  -- which model produced it. Lets the user (and us) understand why a
  -- given run found what it found.
  report_type text not null default 'general',
  input_summary jsonb,
  model text,

  created_at timestamptz default now()
);

create index idx_theme_reports_user_time on theme_reports(user_id, created_at desc);

alter table theme_reports enable row level security;

create policy "Users can manage own theme reports"
  on theme_reports for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant all on theme_reports to authenticated;
