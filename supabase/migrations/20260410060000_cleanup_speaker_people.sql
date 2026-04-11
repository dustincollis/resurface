-- Delete people records that are generic speaker labels (Speaker 1, Speaker 2, etc.)
-- These were incorrectly created during the initial backfill.
-- First remove their meeting_attendees links, then delete the people.

delete from meeting_attendees
where person_id in (
  select id from people where name ~* '^speaker\s*\d+$'
);

delete from people where name ~* '^speaker\s*\d+$';
