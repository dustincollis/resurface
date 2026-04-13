-- Enhanced proposal review actions:
-- 1. 'assigned_to_other' — confirms AI attribution was correct, item belongs to NAME
-- 2. suggested_merge_target_id — parser's detected duplicate from existing items
-- 3. delegated_items table — lightweight log feeding future "NAME's plate" views

alter table proposals drop constraint if exists proposals_review_action_check;
alter table proposals add constraint proposals_review_action_check check (
  review_action is null or review_action = any (array[
    'accept', 'edit', 'merge', 'not_actionable', 'dismiss_banter', 'assigned_to_other'
  ])
);

alter table proposals add column if not exists suggested_merge_target_id uuid references items(id) on delete set null;

create table if not exists delegated_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  proposal_id uuid references proposals(id) on delete set null,
  assigned_to_name text not null,
  title text not null,
  description text,
  evidence_text text,
  due_date date,
  company text,
  source_meeting_id uuid references meetings(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_delegated_items_user_name on delegated_items(user_id, assigned_to_name);
create index if not exists idx_delegated_items_user_created on delegated_items(user_id, created_at desc);
create index if not exists idx_delegated_items_proposal on delegated_items(proposal_id) where proposal_id is not null;

alter table delegated_items enable row level security;
create policy "Users can manage own delegated items"
  on delegated_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
