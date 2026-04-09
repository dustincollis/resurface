-- Proposals: AI-extracted interpretations awaiting user review
-- All five proposal_type values are stubbed in the enum so future chunks
-- (commitments, drafts, etc.) can land without schema churn. Only `task`
-- has a working acceptance handler in chunk 0.

create table proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,

  -- Type & source
  proposal_type text not null check (proposal_type in (
    'task', 'commitment', 'memory', 'draft', 'deadline_adjustment'
  )),
  source_type text not null check (source_type in (
    'meeting', 'transcript', 'chat', 'manual', 'reconciliation'
  )),
  source_id uuid,

  -- Evidence & payloads
  evidence_text text,
  normalized_payload jsonb not null default '{}'::jsonb,
  accepted_payload jsonb,

  -- Metadata
  confidence float check (confidence is null or (confidence >= 0 and confidence <= 1)),
  ambiguity_flags text[] not null default '{}',

  -- State
  status text not null default 'pending' check (status in (
    'pending', 'accepted', 'rejected', 'merged', 'dismissed'
  )),
  review_action text check (review_action is null or review_action in (
    'accept', 'edit', 'merge', 'not_actionable', 'dismiss_banter'
  )),

  -- Outputs (set on accept/merge)
  resulting_object_type text,
  resulting_object_id uuid,
  merge_target_id uuid,

  -- Timestamps
  created_at timestamptz default now(),
  reviewed_at timestamptz,
  updated_at timestamptz default now()
);

create index idx_proposals_user_pending on proposals(user_id, created_at desc)
  where status = 'pending';
create index idx_proposals_source on proposals(source_type, source_id);
create index idx_proposals_user_created on proposals(user_id, created_at desc);

alter table proposals enable row level security;
create policy "Users can manage own proposals"
  on proposals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_proposals_updated_at
  before update on proposals
  for each row execute function update_updated_at();

-- Realtime: stream proposal changes to the review queue UI
alter publication supabase_realtime add table proposals;
