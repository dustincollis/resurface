-- Similarity and source-search RPCs for the Utility / Similar surface.

create or replace function find_similar(
  source_table text,
  source_id uuid,
  searching_user_id uuid,
  max_results int default 8
)
returns table (
  result_table text,
  result_id uuid,
  title text,
  snippet text,
  created_at timestamptz,
  similarity float
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_embedding vector(1024);
  bounded_limit int := greatest(1, least(coalesce(max_results, 8), 20));
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and auth.uid() is distinct from searching_user_id then
    raise exception 'forbidden';
  end if;

  case source_table
    when 'ideas' then
      select i.embedding into source_embedding
      from ideas i
      where i.id = source_id and i.user_id = searching_user_id;
    when 'memories' then
      select m.embedding into source_embedding
      from memories m
      where m.id = source_id and m.user_id = searching_user_id;
    when 'commitments' then
      select c.embedding into source_embedding
      from commitments c
      where c.id = source_id and c.user_id = searching_user_id;
    when 'meetings' then
      select m.embedding into source_embedding
      from meetings m
      where m.id = source_id and m.user_id = searching_user_id;
    else
      raise exception 'unsupported source_table: %', source_table;
  end case;

  if source_embedding is null then
    return;
  end if;

  return query
  select *
  from (
    select
      'ideas'::text as result_table,
      i.id as result_id,
      i.title,
      left(coalesce(nullif(i.description, ''), nullif(i.context_notes, ''), nullif(i.evidence_text, ''), i.title), 280) as snippet,
      i.created_at,
      (1 - (i.embedding <=> source_embedding))::float as similarity
    from ideas i
    where i.user_id = searching_user_id
      and i.embedding is not null
      and not (source_table = 'ideas' and i.id = source_id)

    union all

    select
      'memories'::text as result_table,
      m.id as result_id,
      left(m.content, 96) as title,
      left(m.content, 280) as snippet,
      m.created_at,
      (1 - (m.embedding <=> source_embedding))::float as similarity
    from memories m
    where m.user_id = searching_user_id
      and m.embedding is not null
      and not (source_table = 'memories' and m.id = source_id)

    union all

    select
      'commitments'::text as result_table,
      c.id as result_id,
      c.title,
      left(coalesce(nullif(c.description, ''), nullif(c.evidence_text, ''), c.title), 280) as snippet,
      c.created_at,
      (1 - (c.embedding <=> source_embedding))::float as similarity
    from commitments c
    where c.user_id = searching_user_id
      and c.embedding is not null
      and not (source_table = 'commitments' and c.id = source_id)

    union all

    select
      'meetings'::text as result_table,
      m.id as result_id,
      m.title,
      left(coalesce(nullif(m.transcript_summary, ''), m.title), 280) as snippet,
      coalesce(m.start_time, m.created_at) as created_at,
      (1 - (m.embedding <=> source_embedding))::float as similarity
    from meetings m
    where m.user_id = searching_user_id
      and m.embedding is not null
      and not (source_table = 'meetings' and m.id = source_id)
  ) candidates
  order by candidates.similarity desc
  limit bounded_limit;
end;
$$;

create or replace function search_similar_sources(
  search_query text,
  searching_user_id uuid,
  max_results int default 20
)
returns table (
  source_table text,
  source_id uuid,
  title text,
  snippet text,
  created_at timestamptz,
  rank float
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q text := trim(coalesce(search_query, ''));
  bounded_limit int := greatest(1, least(coalesce(max_results, 20), 50));
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and auth.uid() is distinct from searching_user_id then
    raise exception 'forbidden';
  end if;

  if length(q) < 2 then
    return;
  end if;

  return query
  select *
  from (
    select
      'ideas'::text as source_table,
      i.id as source_id,
      i.title,
      left(coalesce(nullif(i.description, ''), nullif(i.context_notes, ''), nullif(i.evidence_text, ''), i.title), 280) as snippet,
      i.created_at,
      (
        coalesce(word_similarity(q, i.title), 0) * 2
        + coalesce(word_similarity(q, coalesce(i.description, '')), 0)
        + case when i.title ilike '%' || q || '%' then 1 else 0 end
      )::float as rank
    from ideas i
    where i.user_id = searching_user_id
      and (
        i.title ilike '%' || q || '%'
        or i.description ilike '%' || q || '%'
        or i.evidence_text ilike '%' || q || '%'
        or i.context_notes ilike '%' || q || '%'
      )

    union all

    select
      'memories'::text as source_table,
      m.id as source_id,
      left(m.content, 96) as title,
      left(m.content, 280) as snippet,
      m.created_at,
      (
        coalesce(word_similarity(q, m.content), 0)
        + case when m.content ilike '%' || q || '%' then 1 else 0 end
      )::float as rank
    from memories m
    where m.user_id = searching_user_id
      and m.content ilike '%' || q || '%'

    union all

    select
      'commitments'::text as source_table,
      c.id as source_id,
      c.title,
      left(coalesce(nullif(c.description, ''), nullif(c.evidence_text, ''), c.title), 280) as snippet,
      c.created_at,
      (
        coalesce(word_similarity(q, c.title), 0) * 2
        + coalesce(word_similarity(q, coalesce(c.description, '')), 0)
        + case when c.title ilike '%' || q || '%' then 1 else 0 end
      )::float as rank
    from commitments c
    where c.user_id = searching_user_id
      and (
        c.title ilike '%' || q || '%'
        or c.description ilike '%' || q || '%'
        or c.evidence_text ilike '%' || q || '%'
      )

    union all

    select
      'meetings'::text as source_table,
      m.id as source_id,
      m.title,
      left(coalesce(nullif(m.transcript_summary, ''), m.title), 280) as snippet,
      coalesce(m.start_time, m.created_at) as created_at,
      (
        coalesce(word_similarity(q, m.title), 0) * 2
        + coalesce(word_similarity(q, coalesce(m.transcript_summary, '')), 0)
        + case when m.title ilike '%' || q || '%' then 1 else 0 end
      )::float as rank
    from meetings m
    where m.user_id = searching_user_id
      and (
        m.title ilike '%' || q || '%'
        or m.transcript_summary ilike '%' || q || '%'
      )
  ) candidates
  order by candidates.rank desc, candidates.created_at desc
  limit bounded_limit;
end;
$$;

revoke execute on function find_similar(text, uuid, uuid, int) from public, anon;
grant execute on function find_similar(text, uuid, uuid, int) to authenticated, service_role;

revoke execute on function search_similar_sources(text, uuid, int) from public, anon;
grant execute on function search_similar_sources(text, uuid, int) to authenticated, service_role;
