-- Proposal groups: AI-suggested clusters of proposals from a single meeting
-- that all contribute to one named deliverable (e.g. "the S&P deck").
-- User accepts the group, which creates a parent item and accepts every
-- member proposal as a task with parent_id set to that parent.
--
-- Groups are never auto-applied; they're a suggestion that waits for review.

create table proposal_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,

  -- Source meeting the cluster came from. Cross-meeting clusters are out
  -- of scope for v1; the column is non-null until we change that.
  source_meeting_id uuid references meetings(id) on delete cascade not null,

  -- AI's suggested name for the parent item. Editable by the user at
  -- accept time; we do not persist the edited title here -- the parent
  -- item carries it after creation.
  suggested_title text not null,

  -- Member proposals. The user can drop individual proposals from the
  -- cluster before accepting via an UPDATE to this array. If length
  -- drops below 2, the group is auto-rejected client-side.
  proposal_ids uuid[] not null default '{}',

  confidence float check (confidence is null or (confidence >= 0 and confidence <= 1)),

  status text not null default 'pending' check (status in (
    'pending', 'accepted', 'rejected'
  )),

  -- On accept, the parent item that got created and set as parent_id on
  -- every member proposal's resulting item.
  resulting_parent_item_id uuid references items(id) on delete set null,

  created_at timestamptz default now(),
  reviewed_at timestamptz,
  updated_at timestamptz default now()
);

create index idx_proposal_groups_user_pending on proposal_groups(user_id, created_at desc)
  where status = 'pending';
create index idx_proposal_groups_meeting on proposal_groups(source_meeting_id);

alter table proposal_groups enable row level security;
create policy "Users can manage own proposal_groups"
  on proposal_groups for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_proposal_groups_updated_at
  before update on proposal_groups
  for each row execute function update_updated_at();

alter publication supabase_realtime add table proposal_groups;
