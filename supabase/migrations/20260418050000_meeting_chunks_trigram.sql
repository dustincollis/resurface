-- Trigram GIN index on meeting_chunks.chunk_text so the bundle report
-- can do per-entity ILIKE lookups (e.g. find every chunk that mentions
-- "Meeta Stocum") without full scans. pg_trgm is already enabled.
create index if not exists idx_meeting_chunks_chunk_text_trgm
  on meeting_chunks using gin (chunk_text gin_trgm_ops);

-- Same for commitments.counterpart and commitments.company since the
-- report fans entity lookups across these columns.
create index if not exists idx_commitments_counterpart_trgm
  on commitments using gin (counterpart gin_trgm_ops);

create index if not exists idx_commitments_company_trgm
  on commitments using gin (company gin_trgm_ops);

create index if not exists idx_pursuits_company_trgm
  on pursuits using gin (company gin_trgm_ops);

create index if not exists idx_memories_content_trgm
  on memories using gin (content gin_trgm_ops);
