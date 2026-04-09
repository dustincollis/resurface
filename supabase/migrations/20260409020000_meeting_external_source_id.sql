-- External source identifier for non-ICS provenance dedup.
-- Use cases: HiNotes Python sync (note_id), future source-specific scripts.
-- ics_uid is reserved for calendar ICS dedup and is not repurposed here.
--
-- Convention for writers: prefix the value with the source so namespaces
-- don't collide between scripts (e.g. 'hinotes:note:5967655381143564288').

alter table public.meetings
  add column external_source_id text;

create unique index idx_meetings_user_external_source
  on public.meetings(user_id, external_source_id)
  where external_source_id is not null;
