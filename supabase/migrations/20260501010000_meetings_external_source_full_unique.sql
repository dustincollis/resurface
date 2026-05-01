-- Replace the partial unique index on (user_id, external_source_id) with a
-- full unique constraint. Why: Postgres's ON CONFLICT inference can't pick up
-- partial unique indexes without specifying their predicate explicitly, and
-- supabase-js's .upsert({ onConflict: '...' }) doesn't expose a way to pass
-- that predicate. So bulk upsert against a partial index errors with 42P10
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" — which is exactly what calendar-sync was hitting after
-- being refactored to bulk upsert (the old per-row SELECT-then-INSERT path
-- worked because it didn't use ON CONFLICT at all).
--
-- Semantics are preserved: Postgres treats NULLs as distinct in unique
-- constraints by default (NULLS DISTINCT), so manually-created meetings
-- (external_source_id IS NULL) still don't conflict with each other. The
-- only effective change is that ON CONFLICT can now infer the constraint.

drop index if exists public.idx_meetings_user_external_source;

alter table public.meetings
  add constraint meetings_user_external_source_unique
  unique (user_id, external_source_id);
