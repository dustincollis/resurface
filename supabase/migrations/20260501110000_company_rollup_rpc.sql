-- Company rollup for account one-pagers.
--
-- This RPC collects the compact, top-of-page account context for
-- /companies/:id. It uses resolved links and exact text fallbacks, and reuses
-- the cached Momentum snapshot for weekly counts.

create or replace function get_company_rollup(
  p_company_id uuid,
  searching_user_id uuid
)
returns table (
  people_count int,
  open_commitments_count int,
  open_ideas_count int,
  recent_meetings jsonb,
  open_commitments jsonb,
  surfaced_ideas jsonb,
  weekly_momentum int[]
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

  if not exists (
    select 1
    from companies c
    where c.id = p_company_id
      and c.user_id = searching_user_id
  ) then
    raise exception 'company not found or access denied';
  end if;

  return query
  with
  target_company as (
    select c.id, c.name
    from companies c
    where c.id = p_company_id
      and c.user_id = searching_user_id
  ),
  company_people as (
    select p.id
    from people p
    where p.user_id = searching_user_id
      and p.company_id = p_company_id
  ),
  company_meetings as (
    select distinct
      m.id,
      m.title,
      m.start_time
    from meetings m
    join meeting_attendees ma on ma.meeting_id = m.id
    join people p on p.id = ma.person_id
    where m.user_id = searching_user_id
      and p.user_id = searching_user_id
      and p.company_id = p_company_id
      and m.start_time is not null
      and m.start_time <= now()
    order by m.start_time desc
    limit 5
  ),
  company_commitments as (
    select
      co.id,
      co.title,
      co.status,
      co.do_by,
      co.created_at
    from commitments co
    cross join target_company tc
    where co.user_id = searching_user_id
      and co.status in ('open', 'waiting')
      and (
        co.company_id = p_company_id
        or lower(co.company) = lower(tc.name)
      )
    order by co.do_by asc nulls last, co.created_at desc
    limit 10
  ),
  company_ideas as (
    select
      i.id,
      i.title,
      i.status,
      i.created_at
    from ideas i
    cross join target_company tc
    where i.user_id = searching_user_id
      and i.status not in ('dismissed', 'archived')
      and (
        i.company_id = p_company_id
        or lower(i.company_name) = lower(tc.name)
      )
    order by i.created_at desc
    limit 10
  )
  select
    (select count(*)::int from company_people) as people_count,
    (select count(*)::int from company_commitments) as open_commitments_count,
    (select count(*)::int from company_ideas) as open_ideas_count,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', cm.id,
            'title', cm.title,
            'start_time', cm.start_time
          )
          order by cm.start_time desc
        )
        from company_meetings cm
      ),
      '[]'::jsonb
    ) as recent_meetings,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', cc.id,
            'title', cc.title,
            'status', cc.status,
            'do_by', cc.do_by
          )
          order by cc.do_by asc nulls last, cc.created_at desc
        )
        from company_commitments cc
      ),
      '[]'::jsonb
    ) as open_commitments,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', ci.id,
            'title', ci.title,
            'status', ci.status,
            'created_at', ci.created_at
          )
          order by ci.created_at desc
        )
        from company_ideas ci
      ),
      '[]'::jsonb
    ) as surfaced_ideas,
    coalesce(
      (
        select uem.weekly_counts
        from utility_entity_momentum uem
        where uem.user_id = searching_user_id
          and uem.entity_type = 'company'
          and uem.entity_id = p_company_id
        limit 1
      ),
      array_fill(0, array[12])
    ) as weekly_momentum;
end;
$$;

revoke all on function get_company_rollup(uuid, uuid) from public;
grant execute on function get_company_rollup(uuid, uuid) to authenticated, service_role;
