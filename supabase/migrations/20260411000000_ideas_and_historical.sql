-- Ideas entity: strategic/tactical concepts surfaced in meetings.
-- Sits alongside Items, Commitments, Pursuits, Goals as a first-class entity.
-- AI extracts candidate ideas from transcripts; user reviews and can promote
-- to Goals or Pursuits.

-- =============================================================
-- 1. Ideas table
-- =============================================================

create table ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,

  -- Core content
  title text not null,
  description text,
  evidence_text text,                  -- quote or close paraphrase from transcript

  -- Origin tracking
  source_meeting_id uuid references meetings(id) on delete set null,
  originated_by text,                  -- name of person who suggested it

  -- Context
  company_id uuid references companies(id) on delete set null,
  company_name text,                   -- fallback if company not yet in directory
  context_notes text,                  -- what problem or opportunity prompted this

  -- Classification
  category text,                       -- gtm_motion, selling_approach, partnership,
                                       -- positioning, campaign, bundling, product,
                                       -- process, other
  tags text[],

  -- Lifecycle
  status text not null default 'surfaced' check (status in (
    'surfaced', 'exploring', 'accepted', 'dismissed', 'archived'
  )),

  -- Graduation links
  promoted_to_goal_id uuid references goals(id) on delete set null,
  promoted_to_pursuit_id uuid references pursuits(id) on delete set null,

  -- Clustering (populated by a later analysis pass)
  cluster_id uuid,
  cluster_label text,

  -- Timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index idx_ideas_user_status on ideas(user_id, status);
create index idx_ideas_source_meeting on ideas(source_meeting_id) where source_meeting_id is not null;
create index idx_ideas_company on ideas(company_id) where company_id is not null;
create index idx_ideas_cluster on ideas(cluster_id) where cluster_id is not null;
create index idx_ideas_category on ideas(user_id, category) where category is not null;

alter table ideas enable row level security;
create policy "Users can manage own ideas"
  on ideas for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_ideas_updated_at
  before update on ideas
  for each row execute function update_updated_at();

alter publication supabase_realtime add table ideas;

-- =============================================================
-- 2. Add extracted_topics to meetings
-- =============================================================

alter table meetings add column extracted_topics text[];

-- =============================================================
-- 3. Add 'historical' to commitments status constraint
-- =============================================================

-- Drop and recreate the check constraint to include 'historical'
alter table commitments drop constraint if exists commitments_status_check;
alter table commitments add constraint commitments_status_check
  check (status in ('open', 'met', 'broken', 'cancelled', 'waiting', 'historical'));
