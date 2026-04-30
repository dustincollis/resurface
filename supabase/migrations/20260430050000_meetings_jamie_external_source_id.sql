-- Track Jamie's external_source_id separately so we can merge a Jamie
-- webhook into a pre-existing calendar_sync row.
--
-- Without this, the two pipelines produce separate rows for the same
-- real meeting:
--   - calendar_sync inserts: external_source_id = 'outlook:event:<id>'
--   - jamie_webhook inserts:  external_source_id = 'jamie:meeting:<id>'
-- Different prefixes, different IDs, no merge — duplicates accumulate.
--
-- With this column, jamie_webhook can:
--   1. Find an existing row by jamie_external_source_id (idempotency on
--      retry — replaces the prior unique-constraint dedup path)
--   2. Find a candidate calendar_sync row by start_time proximity
--   3. UPDATE the calendar row (preserving its outlook:event ID) with
--      Jamie's transcript + attendees, stamping jamie_external_source_id
--      so the merge is durable
--   4. Fall through to INSERT only when there's no calendar candidate
--      (e.g. ad-hoc meeting Jamie recorded without a calendar event)
--
-- Existing Jamie rows keep their external_source_id; we'll backfill
-- jamie_external_source_id from external_source_id where source =
-- 'jamie_webhook' so retries on already-ingested rows still dedupe.

alter table meetings add column jamie_external_source_id text;

-- Backfill: every existing Jamie row has its external_source_id as the
-- jamie ID. Mirror it to the new column so future Jamie retries dedupe
-- via either column path.
update meetings
set jamie_external_source_id = external_source_id
where source = 'jamie_webhook'
  and external_source_id is not null
  and external_source_id like 'jamie:%';

-- Unique index on jamie_external_source_id (per user) — partial so rows
-- without it (calendar-only, or future-dated unmatched) don't conflict.
create unique index idx_meetings_user_jamie_ext
  on meetings(user_id, jamie_external_source_id)
  where jamie_external_source_id is not null;

-- Helpful index for the merge lookup: find calendar_sync rows in a
-- time window for a given user.
create index if not exists idx_meetings_user_source_starttime
  on meetings(user_id, source, start_time);
