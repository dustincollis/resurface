-- Idea quality triage: AI-scored signal level per idea.
-- Used to filter out low-signal parser output (Speaker N attributions,
-- tactical minutiae, out-of-scope commentary from other people).

alter table ideas add column if not exists quality text check (quality in ('high', 'medium', 'low'));
alter table ideas add column if not exists triage_reason text;
alter table ideas add column if not exists triaged_at timestamptz;

create index if not exists idx_ideas_quality on ideas(user_id, quality) where quality is not null;
