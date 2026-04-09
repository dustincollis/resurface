-- Pursuits: user-flagged threads of focus that should NOT fade into the
-- background when other work crowds them out. A pursuit collects items,
-- commitments, and meetings under one named banner (e.g. "S&P Mobility").
--
-- Status: active is the only "live" state. won / lost are terminal sales
-- outcomes; archived is a generic catch-all for non-deal pursuits that
-- wrap without a specific outcome.
--
-- Membership is polymorphic via pursuit_members so a single join table
-- covers items, commitments, and (eventually) any new entity type we add.

create table pursuits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,

  name text not null,
  description text,
  company text,
  status text not null default 'active' check (status in (
    'active', 'won', 'lost', 'archived'
  )),
  color text default '#8B5CF6',  -- purple default; user can change later
  sort_order int default 0,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz
);

-- Names unique per user, case-insensitive, to prevent accidental dupes
create unique index idx_pursuits_user_name_lower on pursuits(user_id, lower(name));
create index idx_pursuits_user_status_sort on pursuits(user_id, status, sort_order);

alter table pursuits enable row level security;
create policy "Users can manage own pursuits"
  on pursuits for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_pursuits_updated_at
  before update on pursuits
  for each row execute function update_updated_at();

alter publication supabase_realtime add table pursuits;

-- ============================================================
-- Polymorphic membership table
-- ============================================================

create table pursuit_members (
  id uuid primary key default gen_random_uuid(),
  pursuit_id uuid references pursuits(id) on delete cascade not null,
  member_type text not null check (member_type in ('item', 'commitment', 'meeting')),
  member_id uuid not null,
  added_at timestamptz default now(),
  unique (pursuit_id, member_type, member_id)
);

create index idx_pursuit_members_pursuit on pursuit_members(pursuit_id);
create index idx_pursuit_members_lookup on pursuit_members(member_type, member_id);

alter table pursuit_members enable row level security;
create policy "Users can manage own pursuit members"
  on pursuit_members for all
  using (exists (
    select 1 from pursuits p where p.id = pursuit_id and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from pursuits p where p.id = pursuit_id and p.user_id = auth.uid()
  ));

alter publication supabase_realtime add table pursuit_members;
