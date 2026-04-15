-- Meeting chunks with pgvector embeddings for semantic search
-- Phase 2: enables vector similarity search across meeting transcripts

-- ============================================================
-- Extension
-- ============================================================
create extension if not exists vector;

-- ============================================================
-- Add embedded_at flag to meetings (resumability for batch embedding)
-- ============================================================
alter table meetings add column if not exists embedded_at timestamptz;
create index if not exists idx_meetings_unembedded
  on meetings(user_id) where embedded_at is null;

-- ============================================================
-- meeting_chunks: topic-segmented transcript chunks with embeddings
-- ============================================================
create table meeting_chunks (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  chunk_index int not null,
  topic_label text not null,
  chunk_text text not null,
  speakers text[] default '{}',
  start_time_offset text,
  end_time_offset text,
  token_count int,
  embedding vector(1024) not null,
  created_at timestamptz default now()
);

create index idx_chunks_meeting on meeting_chunks(meeting_id);
create index idx_chunks_user on meeting_chunks(user_id);
create index idx_chunks_embedding on meeting_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ============================================================
-- RLS
-- ============================================================
alter table meeting_chunks enable row level security;
create policy "Users can manage own chunks"
  on meeting_chunks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- Semantic search RPC
-- ============================================================
create or replace function search_meeting_chunks(
  query_embedding vector(1024),
  searching_user_id uuid,
  match_count int default 20,
  similarity_threshold float default 0.3
)
returns table (
  chunk_id uuid,
  meeting_id uuid,
  meeting_title text,
  meeting_date timestamptz,
  chunk_index int,
  topic_label text,
  chunk_text text,
  speakers text[],
  start_time_offset text,
  end_time_offset text,
  similarity float
)
language plpgsql
security definer
as $$
begin
  return query
  select
    mc.id as chunk_id,
    mc.meeting_id,
    m.title as meeting_title,
    m.start_time as meeting_date,
    mc.chunk_index,
    mc.topic_label,
    mc.chunk_text,
    mc.speakers,
    mc.start_time_offset,
    mc.end_time_offset,
    (1 - (mc.embedding <=> query_embedding))::float as similarity
  from meeting_chunks mc
  join meetings m on m.id = mc.meeting_id
  where mc.user_id = searching_user_id
    and (1 - (mc.embedding <=> query_embedding)) > similarity_threshold
  order by mc.embedding <=> query_embedding
  limit match_count;
end;
$$;
