-- Mentioned companies on meetings: every distinct organization spoken
-- about in the discussion that isn't the meeting's primary subject.
--
-- The existing `discussion_company` text column captures the meeting's
-- single dominant topic ("this meeting was about S&P"). It misses the
-- common case of a partner sync where multiple client accounts come
-- up in passing ("we should pitch OrangeLogic to Walmart and the Met").
-- Without that signal, the partner activity feed has nothing to chip
-- those accounts under.
--
-- Stored as text[] for simplicity — names only, parser-extracted. The
-- partner-activity RPC resolves names to companies.id by case-insensitive
-- exact match at query time. Names that don't resolve are still useful
-- as plain-text chips and can graduate to FK-linked companies once the
-- user creates them.

alter table meetings
  add column mentioned_companies text[] not null default '{}'::text[];

-- GIN index lets us search/filter by membership without a sequential
-- scan once the column is populated. Cheap when the column is empty;
-- meaningful once parser writes start filling it.
create index idx_meetings_mentioned_companies
  on meetings using gin (mentioned_companies);
