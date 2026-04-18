-- Context Bundles — queryable event/onsite briefing packs
-- Tables: bundles, bundle_documents, bundle_chunks (pgvector), bundle_entities,
--         bundle_gaps, bundle_reports
-- Also extends chat_messages.scope_type to include 'bundle'.

-- ============================================================
-- Extend chat_messages scope
-- ============================================================
alter table chat_messages drop constraint chat_messages_scope_type_check;
alter table chat_messages add constraint chat_messages_scope_type_check
  check (scope_type in ('global', 'item', 'goal', 'bundle'));

-- ============================================================
-- bundles — one row per event / onsite / QBR pack
-- ============================================================
create table bundles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  kind text not null default 'event' check (kind in ('event', 'onsite', 'qbr', 'other')),
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'ingesting', 'ready', 'error')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_bundles_user on bundles(user_id, created_at desc);

alter table bundles enable row level security;
create policy "Users manage own bundles"
  on bundles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- bundle_documents — one row per source markdown file pasted in
-- ============================================================
create table bundle_documents (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid references bundles(id) on delete cascade not null,
  title text not null,
  content_md text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_bundle_documents_bundle on bundle_documents(bundle_id, position);

alter table bundle_documents enable row level security;
create policy "Users manage own bundle_documents"
  on bundle_documents for all
  using (
    exists (
      select 1 from bundles b
      where b.id = bundle_id and b.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from bundles b
      where b.id = bundle_id and b.user_id = auth.uid()
    )
  );

-- ============================================================
-- bundle_chunks — section-level chunks with embeddings
-- ============================================================
create table bundle_chunks (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid references bundles(id) on delete cascade not null,
  document_id uuid references bundle_documents(id) on delete cascade not null,
  section_path text not null,   -- e.g. "Schedule > Monday April 21"
  content text not null,
  embedding vector(1024) not null,
  token_count int,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_bundle_chunks_bundle on bundle_chunks(bundle_id);
create index idx_bundle_chunks_document on bundle_chunks(document_id);
create index idx_bundle_chunks_embedding on bundle_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
create index idx_bundle_chunks_fts on bundle_chunks
  using gin (to_tsvector('english', content));

alter table bundle_chunks enable row level security;
create policy "Users manage own bundle_chunks"
  on bundle_chunks for all
  using (
    exists (
      select 1 from bundles b
      where b.id = bundle_id and b.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from bundles b
      where b.id = bundle_id and b.user_id = auth.uid()
    )
  );

-- ============================================================
-- bundle_entities — people and companies mentioned in the bundle
-- ============================================================
create table bundle_entities (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid references bundles(id) on delete cascade not null,
  entity_type text not null check (entity_type in ('person', 'company')),
  entity_id uuid,            -- null when not resolved to a Resurface record
  raw_name text not null,    -- name as it appeared in the source text
  mention_count int not null default 1,
  created_at timestamptz not null default now()
);

create index idx_bundle_entities_bundle on bundle_entities(bundle_id, entity_type);
create unique index idx_bundle_entities_unique
  on bundle_entities(bundle_id, entity_type, lower(raw_name));

alter table bundle_entities enable row level security;
create policy "Users manage own bundle_entities"
  on bundle_entities for all
  using (
    exists (
      select 1 from bundles b
      where b.id = bundle_id and b.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from bundles b
      where b.id = bundle_id and b.user_id = auth.uid()
    )
  );

-- ============================================================
-- bundle_gaps — open items / unknowns parsed from the briefing
-- ============================================================
create table bundle_gaps (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid references bundles(id) on delete cascade not null,
  content text not null,
  state text not null default 'open' check (state in ('open', 'resolved', 'deferred')),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_bundle_gaps_bundle on bundle_gaps(bundle_id, position);

alter table bundle_gaps enable row level security;
create policy "Users manage own bundle_gaps"
  on bundle_gaps for all
  using (
    exists (
      select 1 from bundles b
      where b.id = bundle_id and b.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from bundles b
      where b.id = bundle_id and b.user_id = auth.uid()
    )
  );

-- ============================================================
-- bundle_reports — AI-synthesized plane-reading narrative
-- ============================================================
create table bundle_reports (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid references bundles(id) on delete cascade not null,
  content_md text not null,
  model text not null,
  generated_at timestamptz not null default now()
);

create index idx_bundle_reports_bundle on bundle_reports(bundle_id, generated_at desc);

alter table bundle_reports enable row level security;
create policy "Users manage own bundle_reports"
  on bundle_reports for all
  using (
    exists (
      select 1 from bundles b
      where b.id = bundle_id and b.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from bundles b
      where b.id = bundle_id and b.user_id = auth.uid()
    )
  );

-- ============================================================
-- Semantic search RPC for bundle chunks (hybrid: vector + FTS)
-- ============================================================
create or replace function search_bundle_chunks(
  p_bundle_id uuid,
  p_user_id uuid,
  query_embedding vector(1024),
  query_text text default null,
  match_count int default 8,
  similarity_threshold float default 0.3
)
returns table (
  chunk_id uuid,
  document_id uuid,
  section_path text,
  content text,
  similarity float,
  fts_rank float
)
language plpgsql
security definer
as $$
begin
  -- Verify bundle ownership
  if not exists (
    select 1 from bundles b
    where b.id = p_bundle_id and b.user_id = p_user_id
  ) then
    raise exception 'bundle not found or access denied';
  end if;

  return query
  select
    bc.id as chunk_id,
    bc.document_id,
    bc.section_path,
    bc.content,
    (1 - (bc.embedding <=> query_embedding))::float as similarity,
    case
      when query_text is not null and query_text <> ''
      then ts_rank(to_tsvector('english', bc.content), plainto_tsquery('english', query_text))
      else 0.0
    end::float as fts_rank
  from bundle_chunks bc
  where bc.bundle_id = p_bundle_id
    and (1 - (bc.embedding <=> query_embedding)) > similarity_threshold
  order by
    -- Hybrid score: 70% semantic, 30% keyword
    (0.7 * (1 - (bc.embedding <=> query_embedding))
      + 0.3 * case
          when query_text is not null and query_text <> ''
          then ts_rank(to_tsvector('english', bc.content), plainto_tsquery('english', query_text))
          else 0.0
        end) desc
  limit match_count;
end;
$$;
