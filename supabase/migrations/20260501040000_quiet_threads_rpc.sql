-- Going Quiet: people and companies that were active recently but have no
-- mentions in the latest silent window.
--
-- A mention is deliberately broad and cheap: resolved meeting attendance,
-- ideas, commitments, and memory text. Topics and ideas-as-entities are left
-- for later because they need fuzzier identity rules.

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
  person_mentions as (
    -- Resolved meeting attendance.
    select
      p.id as entity_id,
      p.name as entity_name,
      m.start_time as mentioned_at
    from people p
    join meeting_attendees ma on ma.person_id = p.id
    join meetings m on m.id = ma.meeting_id
    where p.user_id = searching_user_id
      and m.user_id = searching_user_id
      and m.start_time is not null
      and m.start_time <= now()

    union all

    -- Ideas attributed to the person.
    select
      p.id as entity_id,
      p.name as entity_name,
      i.created_at as mentioned_at
    from people p
    join ideas i on i.user_id = p.user_id
    where p.user_id = searching_user_id
      and i.originated_by is not null
      and (
        lower(i.originated_by) = lower(p.name)
        or i.originated_by ilike concat('%', p.name, '%')
      )

    union all

    -- Commitments whose counterpart resolves to, or textually mentions, them.
    select
      p.id as entity_id,
      p.name as entity_name,
      c.created_at as mentioned_at
    from people p
    join commitments c on c.user_id = p.user_id
    where p.user_id = searching_user_id
      and (
        c.person_id = p.id
        or lower(coalesce(c.counterpart, '')) = lower(p.name)
        or c.counterpart ilike concat('%', p.name, '%')
      )

    union all

    -- Memories that mention the person by canonical name.
    select
      p.id as entity_id,
      p.name as entity_name,
      mem.created_at as mentioned_at
    from people p
    join memories mem on mem.user_id = p.user_id
    where p.user_id = searching_user_id
      and mem.content ilike concat('%', p.name, '%')
  ),
  meeting_company_counts as (
    select
      m.id as meeting_id,
      m.start_time,
      p.company_id,
      count(*) as attendee_count
    from meetings m
    join meeting_attendees ma on ma.meeting_id = m.id
    join people p on p.id = ma.person_id
    where m.user_id = searching_user_id
      and p.user_id = searching_user_id
      and p.company_id is not null
      and m.start_time is not null
      and m.start_time <= now()
    group by m.id, m.start_time, p.company_id
  ),
  primary_meeting_companies as (
    select meeting_id, start_time, company_id
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
    -- Meeting mention for the company most represented among resolved attendees.
    select
      c.id as entity_id,
      c.name as entity_name,
      pmc.start_time as mentioned_at
    from companies c
    join primary_meeting_companies pmc on pmc.company_id = c.id
    where c.user_id = searching_user_id

    union all

    -- Ideas linked to or textually tagged with the company.
    select
      c.id as entity_id,
      c.name as entity_name,
      i.created_at as mentioned_at
    from companies c
    join ideas i on i.user_id = c.user_id
    where c.user_id = searching_user_id
      and (
        i.company_id = c.id
        or i.company_name ilike concat('%', c.name, '%')
      )

    union all

    -- Commitments linked to or textually tagged with the company.
    select
      c.id as entity_id,
      c.name as entity_name,
      co.created_at as mentioned_at
    from companies c
    join commitments co on co.user_id = c.user_id
    where c.user_id = searching_user_id
      and (
        co.company_id = c.id
        or co.company ilike concat('%', c.name, '%')
      )
  ),
  all_mentions as (
    select
      'person'::text as entity_type,
      pm.entity_id,
      pm.entity_name,
      pm.mentioned_at
    from person_mentions pm

    union all

    select
      'company'::text as entity_type,
      cm.entity_id,
      cm.entity_name,
      cm.mentioned_at
    from company_mentions cm
  ),
  aggregated as (
    select
      am.entity_type,
      am.entity_id,
      am.entity_name,
      max(am.mentioned_at) as last_mention_at,
      count(*) filter (
        where am.mentioned_at >= now() - make_interval(days => silent_days + active_window_days)
          and am.mentioned_at < now() - make_interval(days => silent_days)
      )::int as prior_mention_count
    from all_mentions am
    where am.mentioned_at is not null
      and am.mentioned_at <= now()
    group by am.entity_type, am.entity_id, am.entity_name
  )
  select
    a.entity_type,
    a.entity_id,
    a.entity_name,
    a.last_mention_at,
    a.prior_mention_count,
    floor(extract(epoch from (now() - a.last_mention_at)) / 86400)::int as days_silent
  from aggregated a
  where a.last_mention_at < now() - make_interval(days => silent_days)
    and a.last_mention_at >= now() - make_interval(days => silent_days + active_window_days)
    and a.prior_mention_count >= min_mentions
  order by days_silent desc, a.prior_mention_count desc, a.entity_name asc;
end;
$$;

revoke all on function get_quiet_threads(uuid, int, int, int) from public;
grant execute on function get_quiet_threads(uuid, int, int, int) to authenticated, service_role;
