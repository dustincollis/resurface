-- Evolve goal_tasks into goal milestones with computed success conditions.
--
-- A milestone can be:
--   'manual'    — user marks it done (original behavior)
--   'pursuit'   — auto-completes when linked pursuit reaches target status
--   'item'      — auto-completes when linked item reaches target status
--   'commitment' — auto-completes when linked commitment reaches target status
--   'meeting'   — auto-completes when a meeting with target criteria exists
--   'count'     — auto-completes when count(entity matching criteria) >= threshold
--
-- The condition_config jsonb stores the specifics for each condition_type.

alter table goal_tasks add column condition_type text not null default 'manual'
  check (condition_type in ('manual', 'pursuit', 'item', 'commitment', 'meeting', 'count'));

-- What entity this milestone is linked to (for pursuit/item/commitment types)
alter table goal_tasks add column linked_entity_id uuid;

-- Target status the linked entity must reach (e.g., 'won', 'done', 'met')
alter table goal_tasks add column target_status text;

-- For 'count' type: entity type to count and threshold
alter table goal_tasks add column condition_config jsonb default '{}';

-- Whether the condition is currently satisfied (computed by evaluator)
alter table goal_tasks add column condition_met boolean not null default false;

-- When the condition was last evaluated
alter table goal_tasks add column last_evaluated_at timestamptz;

-- Evidence: what entity/event satisfied this milestone
alter table goal_tasks add column evidence_text text;

create index idx_goal_tasks_linked on goal_tasks(linked_entity_id) where linked_entity_id is not null;
