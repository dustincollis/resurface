-- Corpus-level embeddings for cross-table similarity.
--
-- Voyage voyage-3-large returns 1024-dimensional vectors. Keeping the
-- same dimension across these tables lets one similarity query bridge
-- ideas, memories, commitments, and meetings.

create extension if not exists vector;

alter table ideas add column if not exists embedding vector(1024);
alter table memories add column if not exists embedding vector(1024);
alter table commitments add column if not exists embedding vector(1024);
alter table meetings add column if not exists embedding vector(1024);

create index if not exists idx_ideas_embedding
  on ideas using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where embedding is not null;

create index if not exists idx_memories_embedding
  on memories using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where embedding is not null;

create index if not exists idx_commitments_embedding
  on commitments using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where embedding is not null;

create index if not exists idx_meetings_embedding
  on meetings using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where embedding is not null;
