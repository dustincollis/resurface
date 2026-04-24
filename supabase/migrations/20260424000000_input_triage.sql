-- Input triage: a cheap catalog pass classifies each new input before the
-- expensive per-input synthesis runs. Skipped inputs never create proposals.
-- Never silently dropped — the decision + reason are persisted so the user
-- can audit and override.
--
-- triage_result values:
--   null         — not yet triaged (legacy rows, or inputs created before
--                  the catalog call completes)
--   'actionable' — catalog decided the input is worth full synthesis
--   'skipped'    — catalog decided no commitments/actions; no synthesis ran
--   'failed'     — catalog call errored; input was NOT synthesized. User
--                  can retry manually.
--
-- thread_group_id: optional opaque id the catalog assigns when multiple
-- inputs in the same batch appear to be part of one email thread. Lets
-- downstream dedupe treat them as a unit.

alter table inputs
  add column triage_result text
    check (triage_result is null or triage_result in ('actionable', 'skipped', 'failed')),
  add column triage_reason text,
  add column thread_group_id uuid;

create index idx_inputs_triage_skipped on inputs(user_id, created_at desc)
  where triage_result = 'skipped';
create index idx_inputs_thread_group on inputs(thread_group_id)
  where thread_group_id is not null;
