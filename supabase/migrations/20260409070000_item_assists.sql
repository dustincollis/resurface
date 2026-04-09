-- AI assists on items: persistent "Help me" responses.
--
-- Three facets per item (configurable via assist_type):
--   approach — how to start, what to gather, what's the first move
--   context  — what's been said about this across meetings/items
--   draft    — a ready-to-use artifact (email, agenda, outline, etc)
--
-- Persisted so the user can read them again without re-burning Claude
-- calls. Regenerate = upsert (the unique index handles it).

create table item_assists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  item_id uuid references items(id) on delete cascade not null,
  assist_type text not null check (assist_type in ('approach', 'context', 'draft')),
  content text not null,
  model text default 'claude-sonnet-4-20250514',
  generated_at timestamptz default now(),
  unique (item_id, assist_type)
);

create index idx_item_assists_item on item_assists(item_id);

alter table item_assists enable row level security;
create policy "Users can manage own item assists"
  on item_assists for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter publication supabase_realtime add table item_assists;
