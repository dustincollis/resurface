-- Pursuit-link proposals: AI-suggested link between a just-parsed meeting and
-- an existing pursuit. User accepts on /proposals, which writes a row into
-- pursuit_members (meeting). Never auto-applied — always a pending suggestion.
--
-- Narrow by design: one meeting → at most one suggested pursuit per run.
-- If the matcher is confident about more than one, we take the top match;
-- the user can still manually link others via the meeting detail page.

create table pursuit_link_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,

  source_meeting_id uuid references meetings(id) on delete cascade not null,
  suggested_pursuit_id uuid references pursuits(id) on delete cascade not null,

  -- Short human-readable rationale ("S&P named 4× in transcript",
  -- "attendee domain matches company"). Shown in the review card.
  reasoning text,

  confidence float check (confidence is null or (confidence >= 0 and confidence <= 1)),

  status text not null default 'pending' check (status in (
    'pending', 'accepted', 'rejected'
  )),

  created_at timestamptz default now(),
  reviewed_at timestamptz,
  updated_at timestamptz default now(),

  -- Prevent the parser from re-proposing the same pair on a retry/reprocess.
  unique (source_meeting_id, suggested_pursuit_id)
);

create index idx_pursuit_link_proposals_user_pending
  on pursuit_link_proposals(user_id, created_at desc)
  where status = 'pending';
create index idx_pursuit_link_proposals_meeting
  on pursuit_link_proposals(source_meeting_id);

alter table pursuit_link_proposals enable row level security;
create policy "Users can manage own pursuit_link_proposals"
  on pursuit_link_proposals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_pursuit_link_proposals_updated_at
  before update on pursuit_link_proposals
  for each row execute function update_updated_at();

alter publication supabase_realtime add table pursuit_link_proposals;
