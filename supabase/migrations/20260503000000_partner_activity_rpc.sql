-- Partner activity feed: meetings the partner attended, with the
-- cross-references resolved server-side. Powers the Partner Activity
-- section on /companies/:id when kind='partner'.
--
-- For each meeting, return:
--   - basic meeting fields (id, title, start_time)
--   - count of pending/sent follow-ups generated from this meeting
--   - count of action items born from this meeting
--   - count of commitments tagged to this meeting
--   - related companies (other than the partner itself), de-duped from
--     three sources: attendee employer, commitments.company_id,
--     items.company_id. Each row carries id+name+kind so the UI can
--     style client/internal/unknown chips differently.
--
-- Most-recent meetings first; the frontend windows to last 30 days by
-- default and reveals older on "Show more".

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
  related_companies jsonb
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
      select distinct m.id, m.title, m.start_time
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
    -- Related companies — three sources, then de-duped & joined to companies
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
    related_all as (
      select * from related_via_attendees
      union
      select * from related_via_commitments
      union
      select * from related_via_items
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
    )
  select
    pm.id as meeting_id,
    pm.title as meeting_title,
    pm.start_time,
    coalesce(fu.n, 0) as follow_ups_count,
    coalesce(ic.n, 0) as items_count,
    coalesce(cmc.n, 0) as commitments_count,
    coalesce(rr.companies, '[]'::jsonb) as related_companies
  from partner_meetings pm
  left join fu_counts fu on fu.meeting_id = pm.id
  left join item_counts ic on ic.meeting_id = pm.id
  left join cm_counts cmc on cmc.meeting_id = pm.id
  left join related_resolved rr on rr.meeting_id = pm.id
  order by pm.start_time desc nulls last
  limit greatest(1, least(coalesce(max_results, 100), 200));
end;
$$;

revoke execute on function get_partner_activity(uuid, uuid, int) from public, anon;
grant execute on function get_partner_activity(uuid, uuid, int) to authenticated, service_role;
