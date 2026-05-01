-- Tighten Going Quiet to the only window it needs. The first version scanned
-- all historical memories / commitments / ideas to compute a result that can
-- only include entities whose latest mention is 30-90 days ago. Keeping source
-- mentions inside the 90-day horizon makes the RPC fast enough for the page.

create or replace function get_quiet_threads(
  searching_user_id uuid,
  silent_days int default 30,
  active_window_days int default 60,
  min_mentions int default 3
)
returns table (
  entity_type text,
  entity_id uuid,
  entity_name text,
  last_mention_at timestamptz,
  prior_mention_count int,
  days_silent int
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
  with
  bounds as (
    select
      now() as window_end,
      now() - make_interval(days => silent_days) as recent_cutoff,
      now() - make_interval(days => silent_days + active_window_days) as window_start
  ),
  person_mentions as (
    select
      p.id as entity_id,
      p.name as entity_name,
      m.start_time as mentioned_at
    from bounds b
    join meetings m on m.user_id = searching_user_id
    join meeting_attendees ma on ma.meeting_id = m.id
    join people p on p.id = ma.person_id and p.user_id = searching_user_id
    where m.start_time >= b.window_start
      and m.start_time <= b.window_end

    union all

    select
      p.id as entity_id,
      p.name as entity_name,
      i.created_at as mentioned_at
    from bounds b
    join ideas i on i.user_id = searching_user_id
    join people p on p.user_id = searching_user_id
    where i.created_at >= b.window_start
      and i.created_at <= b.window_end
      and i.originated_by is not null
      and (
        lower(i.originated_by) = lower(p.name)
        or i.originated_by ilike concat('%', p.name, '%')
      )

    union all

    select
      p.id as entity_id,
      p.name as entity_name,
      c.created_at as mentioned_at
    from bounds b
    join commitments c on c.user_id = searching_user_id
    join people p on p.user_id = searching_user_id
    where c.created_at >= b.window_start
      and c.created_at <= b.window_end
      and (
        c.person_id = p.id
        or lower(coalesce(c.counterpart, '')) = lower(p.name)
        or c.counterpart ilike concat('%', p.name, '%')
      )

    union all

    select
      p.id as entity_id,
      p.name as entity_name,
      mem.created_at as mentioned_at
    from bounds b
    join memories mem on mem.user_id = searching_user_id
    join people p on p.user_id = searching_user_id
    where mem.created_at >= b.window_start
      and mem.created_at <= b.window_end
      and mem.content ilike concat('%', p.name, '%')
  ),
  meeting_company_counts as (
    select
      m.id as meeting_id,
      m.start_time,
      p.company_id,
      count(*) as attendee_count
    from bounds b
    join meetings m on m.user_id = searching_user_id
    join meeting_attendees ma on ma.meeting_id = m.id
    join people p on p.id = ma.person_id and p.user_id = searching_user_id
    where p.company_id is not null
      and m.start_time >= b.window_start
      and m.start_time <= b.window_end
    group by m.id, m.start_time, p.company_id
  ),
  primary_meeting_companies as (
    select ranked.meeting_id, ranked.start_time, ranked.company_id
    from (
      select
        mcc.*,
        row_number() over (
          partition by mcc.meeting_id
          order by mcc.attendee_count desc, mcc.company_id
        ) as rn
      from meeting_company_counts mcc
    ) ranked
    where ranked.rn = 1
  ),
  company_mentions as (
    select
      c.id as entity_id,
      c.name as entity_name,
      pmc.start_time as mentioned_at
    from primary_meeting_companies pmc
    join companies c on c.id = pmc.company_id and c.user_id = searching_user_id

    union all

    select
      c.id as entity_id,
      c.name as entity_name,
      i.created_at as mentioned_at
    from bounds b
    join ideas i on i.user_id = searching_user_id
    join companies c on c.user_id = searching_user_id
    where i.created_at >= b.window_start
      and i.created_at <= b.window_end
      and (
        i.company_id = c.id
        or i.company_name ilike concat('%', c.name, '%')
      )

    union all

    select
      c.id as entity_id,
      c.name as entity_name,
      co.created_at as mentioned_at
    from bounds b
    join commitments co on co.user_id = searching_user_id
    join companies c on c.user_id = searching_user_id
    where co.created_at >= b.window_start
      and co.created_at <= b.window_end
      and (
        co.company_id = c.id
        or co.company ilike concat('%', c.name, '%')
      )
  ),
  all_mentions as (
    select
      'person'::text as mention_entity_type,
      pm.entity_id,
      pm.entity_name,
      pm.mentioned_at
    from person_mentions pm

    union all

    select
      'company'::text as mention_entity_type,
      cm.entity_id,
      cm.entity_name,
      cm.mentioned_at
    from company_mentions cm
  ),
  aggregated as (
    select
      am.mention_entity_type,
      am.entity_id,
      am.entity_name,
      max(am.mentioned_at) as last_mention_at,
      count(*) filter (
        where am.mentioned_at >= b.window_start
          and am.mentioned_at < b.recent_cutoff
      )::int as prior_mention_count
    from all_mentions am
    cross join bounds b
    group by am.mention_entity_type, am.entity_id, am.entity_name
  )
  select
    a.mention_entity_type as entity_type,
    a.entity_id,
    a.entity_name,
    a.last_mention_at,
    a.prior_mention_count,
    floor(extract(epoch from (b.window_end - a.last_mention_at)) / 86400)::int as days_silent
  from aggregated a
  cross join bounds b
  where a.last_mention_at < b.recent_cutoff
    and a.last_mention_at >= b.window_start
    and a.prior_mention_count >= min_mentions
  order by days_silent desc, a.prior_mention_count desc, a.entity_name asc;
end;
$$;

revoke all on function get_quiet_threads(uuid, int, int, int) from public;
grant execute on function get_quiet_threads(uuid, int, int, int) to authenticated, service_role;
