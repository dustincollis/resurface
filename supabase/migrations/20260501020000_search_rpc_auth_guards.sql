-- Harden SECURITY DEFINER search RPCs for multi-user safety.
--
-- These functions intentionally accept a user_id parameter because callers
-- need to search a user's scoped data. Since they run as SECURITY DEFINER,
-- RLS is bypassed inside the function body, so authenticated callers must not
-- be allowed to choose someone else's UUID. Service-role callers are still
-- allowed for Edge Functions / MCP tooling that already authenticate before
-- resolving the target user.

create or replace function search_everything(
  search_query text,
  searching_user_id uuid,
  max_results int default 20
)
returns table (
  result_type text,
  result_id uuid,
  title text,
  snippet text,
  stream_name text,
  status text,
  rank float
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and auth.uid() is distinct from searching_user_id then
    raise exception 'forbidden';
  end if;

  return query

  select
    'item'::text as result_type,
    i.id as result_id,
    i.title,
    ts_headline('english', coalesce(i.description, ''),
      websearch_to_tsquery('english', search_query),
      'MaxWords=35, MinWords=15, StartSel=**, StopSel=**'
    ) as snippet,
    s.name as stream_name,
    i.status,
    (
      coalesce(ts_rank(i.search_vector,
        websearch_to_tsquery('english', search_query)), 0) * 2
      + coalesce(word_similarity(search_query, i.title), 0)
      + coalesce(word_similarity(search_query, i.description), 0) * 0.5
    )::float as rank
  from items i
  left join streams s on s.id = i.stream_id
  where i.user_id = searching_user_id
    and (
      i.search_vector @@ websearch_to_tsquery('english', search_query)
      or search_query <% i.title
      or search_query <% i.description
    )

  union all

  select
    'meeting'::text as result_type,
    m.id as result_id,
    m.title,
    ts_headline('english', coalesce(m.transcript_summary, m.title, ''),
      websearch_to_tsquery('english', search_query),
      'MaxWords=35, MinWords=15, StartSel=**, StopSel=**'
    ) as snippet,
    null::text as stream_name,
    null::text as status,
    (
      coalesce(ts_rank(m.search_vector,
        websearch_to_tsquery('english', search_query)), 0) * 2
      + coalesce(word_similarity(search_query, m.title), 0)
    )::float as rank
  from meetings m
  where m.user_id = searching_user_id
    and (
      m.search_vector @@ websearch_to_tsquery('english', search_query)
      or search_query <% m.title
    )

  order by rank desc
  limit max_results;
end;
$$;

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
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and auth.uid() is distinct from searching_user_id then
    raise exception 'forbidden';
  end if;

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
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and auth.uid() is distinct from p_user_id then
    raise exception 'forbidden';
  end if;

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
    (0.7 * (1 - (bc.embedding <=> query_embedding))
      + 0.3 * case
          when query_text is not null and query_text <> ''
          then ts_rank(to_tsvector('english', bc.content), plainto_tsquery('english', query_text))
          else 0.0
        end) desc
  limit match_count;
end;
$$;
