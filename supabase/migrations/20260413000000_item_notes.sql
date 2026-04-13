-- Append-only notes for items (running progress log)
create table item_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index idx_item_notes_item_created on item_notes (item_id, created_at desc);

-- RLS
alter table item_notes enable row level security;

create policy "Users can read own item notes"
  on item_notes for select
  using (user_id = auth.uid());

create policy "Users can insert own item notes"
  on item_notes for insert
  with check (user_id = auth.uid());
