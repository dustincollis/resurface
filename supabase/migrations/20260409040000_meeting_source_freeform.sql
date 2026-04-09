-- Drop the overly-restrictive source CHECK constraint on meetings.
-- The original schema only allowed 'ics_import' | 'manual' | 'transcript_upload',
-- which blocks new ingestion sources like 'hinotes_sync' from the Python sync
-- script. The column is informational provenance — let it be free-form text.

alter table public.meetings
  drop constraint if exists meetings_source_check;
