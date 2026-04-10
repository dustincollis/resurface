-- Evidence-based playbooks: track which template a pursuit was created from,
-- and maintain a living checklist of template steps with evidence state.
--
-- Each step can be evidenced by:
--   - A linked item/commitment/meeting (auto-detected)
--   - Manual marking ("I did this offline")
--
-- The playbook_steps table is separate from pursuit_members because it
-- tracks the TEMPLATE relationship, not the entity membership.

-- Track which template a pursuit was created from
alter table pursuits add column template_id uuid references templates(id) on delete set null;

-- Playbook steps: one row per template_step for each pursuit using that template
create table pursuit_playbook_steps (
  id uuid primary key default gen_random_uuid(),
  pursuit_id uuid references pursuits(id) on delete cascade not null,
  template_step_id uuid references template_steps(id) on delete cascade not null,
  title text not null,                          -- copied from template_step at creation time
  sort_order int not null default 0,

  -- Evidence state
  evidenced boolean not null default false,
  evidenced_at timestamptz,
  evidence_type text check (evidence_type is null or evidence_type in (
    'item', 'commitment', 'meeting', 'manual'
  )),
  evidence_entity_id uuid,                      -- linked item/commitment/meeting that proves this step
  evidence_note text,                           -- for manual evidence: "Did this in a call with Holly"

  created_at timestamptz default now()
);

create index idx_playbook_steps_pursuit on pursuit_playbook_steps(pursuit_id, sort_order);
create unique index idx_playbook_steps_pursuit_step on pursuit_playbook_steps(pursuit_id, template_step_id);

alter table pursuit_playbook_steps enable row level security;
create policy "Users can manage own playbook steps"
  on pursuit_playbook_steps for all
  using (exists (
    select 1 from pursuits p where p.id = pursuit_id and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from pursuits p where p.id = pursuit_id and p.user_id = auth.uid()
  ));

alter publication supabase_realtime add table pursuit_playbook_steps;
