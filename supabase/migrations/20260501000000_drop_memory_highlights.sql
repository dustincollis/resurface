-- Drop morning_briefings.memory_highlights — turned out person-name-anchored
-- memory matching surfaced facts about people that weren't relevant to the
-- specific meeting context (e.g. James Shilton's EMEA leads matched whenever
-- James was on the calendar, regardless of what the meeting was about).
-- Removed from the briefing surface; the data was empty signal in practice.
--
-- The memories table itself is untouched — memories continue to accumulate
-- and remain accessible everywhere else (chat context, etc.). Only the
-- briefing-side caching column is going away.

alter table morning_briefings drop column if exists memory_highlights;
