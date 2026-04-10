-- Templates: reusable process maps that can be stamped onto pursuits or goals.
-- Managed in Settings. Each template has ordered steps that become items
-- (when applied to a pursuit) or goal_tasks (when applied to a goal).

create table templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  description text,
  template_type text not null check (template_type in ('pursuit', 'goal')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_templates_user_type on templates(user_id, template_type);

alter table templates enable row level security;
create policy "Users can manage own templates"
  on templates for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_templates_updated_at
  before update on templates
  for each row execute function update_updated_at();

create table template_steps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references templates(id) on delete cascade not null,
  title text not null,
  description text,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create index idx_template_steps_template_order on template_steps(template_id, sort_order);

alter table template_steps enable row level security;
create policy "Users can manage own template steps"
  on template_steps for all
  using (exists (
    select 1 from templates t where t.id = template_id and t.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from templates t where t.id = template_id and t.user_id = auth.uid()
  ));

-- Goals: strategic objectives that sit above pursuits. Have their own
-- task lists (goal_tasks) that don't participate in the main item system
-- (no staleness, no proposals, no dashboard). Can be created from a
-- goal-type template.

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  description text,
  status text not null default 'active' check (status in (
    'active', 'completed', 'archived'
  )),
  template_id uuid references templates(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz
);

create index idx_goals_user_status on goals(user_id, status);

alter table goals enable row level security;
create policy "Users can manage own goals"
  on goals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_goals_updated_at
  before update on goals
  for each row execute function update_updated_at();

alter publication supabase_realtime add table goals;

create table goal_tasks (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid references goals(id) on delete cascade not null,
  title text not null,
  description text,
  sort_order int not null default 0,
  status text not null default 'pending' check (status in (
    'pending', 'in_progress', 'done', 'skipped'
  )),
  due_date date,
  created_at timestamptz default now(),
  completed_at timestamptz
);

create index idx_goal_tasks_goal_order on goal_tasks(goal_id, sort_order);

alter table goal_tasks enable row level security;
create policy "Users can manage own goal tasks"
  on goal_tasks for all
  using (exists (
    select 1 from goals g where g.id = goal_id and g.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from goals g where g.id = goal_id and g.user_id = auth.uid()
  ));

alter publication supabase_realtime add table goal_tasks;
