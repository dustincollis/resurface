-- Commitments: outgoing soft obligations the user has made.
-- Distinct from items (which are explicit deliverable tasks). A commitment
-- captures the relational/social side of work — "I owe him one", "I'll
-- get back to you next week", "let me follow up". Some commitments
-- correspond to items; many do not.
--
-- Multi-date model: in practice the parser will mostly only know `do_by`
-- (the internal target). `promised_by` and `needs_review_by` are optional
-- escape hatches for the rare case where the user wants to track all three.

create table commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,

  -- Content
  title text not null,
  description text,
  counterpart text,                 -- name of the other party (free text)
  company text,                     -- optional account/client tag

  -- Dates: do_by is primary, others optional
  do_by date,
  promised_by date,
  needs_review_by date,

  -- State
  status text not null default 'open' check (status in (
    'open', 'met', 'broken', 'cancelled', 'waiting'
  )),

  -- Provenance
  source_meeting_id uuid references meetings(id) on delete set null,
  source_item_id uuid references items(id) on delete set null,
  evidence_text text,               -- verbatim quote from the source
  confidence float check (confidence is null or (confidence >= 0 and confidence <= 1)),

  -- Timestamps
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz
);

create index idx_commitments_user_status on commitments(user_id, status, do_by nulls last);
create index idx_commitments_source_meeting on commitments(source_meeting_id) where source_meeting_id is not null;
create index idx_commitments_source_item on commitments(source_item_id) where source_item_id is not null;

alter table commitments enable row level security;
create policy "Users can manage own commitments"
  on commitments for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_commitments_updated_at
  before update on commitments
  for each row execute function update_updated_at();

alter publication supabase_realtime add table commitments;
