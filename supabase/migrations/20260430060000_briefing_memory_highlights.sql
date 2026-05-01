-- Add memory_highlights to morning_briefings: a small list of memories
-- whose content references people or companies on today's calendar.
-- Verbatim recall to "wake the brain up" — not synthesis.
--
-- Each entry is a memory row's id + content + matched names. Capped at
-- 2-4 per briefing in the edge function so the section stays scannable.

alter table morning_briefings
  add column memory_highlights jsonb not null default '[]'::jsonb;
