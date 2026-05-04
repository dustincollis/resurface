-- Extend get_partner_activity to use the new meetings.mentioned_companies
-- text array as a fourth source for related accounts. Names are resolved
-- to companies.id via case-insensitive exact match; unmatched names show
-- up as text-only chips so users can see the mention even before the
-- company exists as a row.

-- Drop required because the return signature gains mentioned_only_names —
-- Postgres doesn't allow CREATE OR REPLACE to change OUT params.
drop function if exists get_partner_activity(uuid, uuid, int);

create or replace function get_partner_activity(
  partner_id uuid,
  searching_user_id uuid,
  max_results int default 100
)
returns table (
  meeting_id uuid,
  meeting_title text,
  start_time timestamptz,
  follow_ups_count int,
  items_count int,
  commitments_count int,
  related_companies jsonb,
  mentioned_only_names text[]
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
    partner as (
      select c.id, c.name
      from companies c
      where c.id = partner_id and c.user_id = searching_user_id
    ),
    -- People who work at the partner; their attendance defines a "partner meeting"
    partner_people as (
      select pe.id
      from people pe
      where pe.user_id = searching_user_id
        and pe.company_id = (select id from partner)
    ),
    -- Distinct meetings the partner attended
    partner_meetings as (
      select distinct m.id, m.title, m.start_time, m.mentioned_companies
      from meetings m
      join meeting_attendees ma on ma.meeting_id = m.id
      where m.user_id = searching_user_id
        and ma.person_id in (select id from partner_people)
    ),
    -- Follow-up counts per meeting (exclude dismissed)
    fu_counts as (
      select source_meeting_id as meeting_id, count(*)::int as n
      from follow_ups
      where user_id = searching_user_id
        and source_meeting_id in (select id from partner_meetings)
        and status <> 'dismissed'
      group by source_meeting_id
    ),
    -- Action item counts per meeting
    item_counts as (
      select source_meeting_id as meeting_id, count(*)::int as n
      from items
      where user_id = searching_user_id
        and source_meeting_id in (select id from partner_meetings)
      group by source_meeting_id
    ),
    -- Commitment counts per meeting
    cm_counts as (
      select source_meeting_id as meeting_id, count(*)::int as n
      from commitments
      where user_id = searching_user_id
        and source_meeting_id in (select id from partner_meetings)
      group by source_meeting_id
    ),
    -- Related companies — four sources, then de-duped & joined to companies
    related_via_attendees as (
      select distinct ma.meeting_id, pe.company_id
      from meeting_attendees ma
      join people pe on pe.id = ma.person_id
      where ma.meeting_id in (select id from partner_meetings)
        and pe.company_id is not null
        and pe.company_id <> (select id from partner)
    ),
    related_via_commitments as (
      select distinct co.source_meeting_id as meeting_id, co.company_id
      from commitments co
      where co.user_id = searching_user_id
        and co.source_meeting_id in (select id from partner_meetings)
        and co.company_id is not null
        and co.company_id <> (select id from partner)
    ),
    related_via_items as (
      select distinct i.source_meeting_id as meeting_id, i.company_id
      from items i
      where i.user_id = searching_user_id
        and i.source_meeting_id in (select id from partner_meetings)
        and i.company_id is not null
        and i.company_id <> (select id from partner)
    ),
    -- Resolve mentioned_companies names to company_ids when an exact
    -- (case-insensitive) match exists on companies.name. Names that
    -- don't resolve fall through into mentioned_only_names below.
    mentioned_unnested as (
      select pm.id as meeting_id, lower(unnest(pm.mentioned_companies)) as name_lc, unnest(pm.mentioned_companies) as raw_name
      from partner_meetings pm
      where pm.mentioned_companies is not null
        and array_length(pm.mentioned_companies, 1) > 0
    ),
    related_via_mentioned as (
      select distinct mu.meeting_id, c.id as company_id
      from mentioned_unnested mu
      join companies c on lower(c.name) = mu.name_lc
        and c.user_id = searching_user_id
      where c.id <> (select id from partner)
    ),
    related_all as (
      select * from related_via_attendees
      union
      select * from related_via_commitments
      union
      select * from related_via_items
      union
      select * from related_via_mentioned
    ),
    related_resolved as (
      select r.meeting_id, jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'kind', c.kind
        ) order by c.name
      ) as companies
      from related_all r
      join companies c on c.id = r.company_id and c.user_id = searching_user_id
      group by r.meeting_id
    ),
    -- Names that didn't resolve to any company. We still want to show
    -- them as plain-text chips so the user can see "Walmart" was talked
    -- about even before they create a Walmart row.
    resolved_names_per_meeting as (
      select r.meeting_id, lower(c.name) as name_lc
      from related_all r
      join companies c on c.id = r.company_id
    ),
    mentioned_only as (
      select mu.meeting_id, array_agg(distinct mu.raw_name order by mu.raw_name) as names
      from mentioned_unnested mu
      where not exists (
        select 1 from resolved_names_per_meeting rn
        where rn.meeting_id = mu.meeting_id and rn.name_lc = mu.name_lc
      )
      and mu.name_lc <> lower((select name from partner))
      group by mu.meeting_id
    )
  select
    pm.id as meeting_id,
    pm.title as meeting_title,
    pm.start_time,
    coalesce(fu.n, 0) as follow_ups_count,
    coalesce(ic.n, 0) as items_count,
    coalesce(cmc.n, 0) as commitments_count,
    coalesce(rr.companies, '[]'::jsonb) as related_companies,
    coalesce(mo.names, '{}'::text[]) as mentioned_only_names
  from partner_meetings pm
  left join fu_counts fu on fu.meeting_id = pm.id
  left join item_counts ic on ic.meeting_id = pm.id
  left join cm_counts cmc on cmc.meeting_id = pm.id
  left join related_resolved rr on rr.meeting_id = pm.id
  left join mentioned_only mo on mo.meeting_id = pm.id
  order by pm.start_time desc nulls last
  limit greatest(1, least(coalesce(max_results, 100), 200));
end;
$$;

revoke execute on function get_partner_activity(uuid, uuid, int) from public, anon;
grant execute on function get_partner_activity(uuid, uuid, int) to authenticated, service_role;
