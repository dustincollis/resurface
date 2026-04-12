-- Cached AI-generated reports for idea clusters.
-- Each cluster can have multiple report types; regeneration overwrites.

create table cluster_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  cluster_id uuid not null,
  cluster_label text not null,
  report_type text not null check (report_type in (
    'strategic_assessment', 'action_plan', 'competitive_landscape', 'account_map', 'trend_analysis'
  )),
  content text not null,
  model text,
  generated_at timestamptz not null default now(),

  unique(user_id, cluster_id, report_type)
);

create index idx_cluster_reports_lookup on cluster_reports(user_id, cluster_id);

alter table cluster_reports enable row level security;
create policy "Users can manage own cluster reports"
  on cluster_reports for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
