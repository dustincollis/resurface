-- Partner joint-pursuit lens: given a partner company, return every
-- pursuit that has any member (meeting, commitment, or item) referencing
-- the partner. The user's working definition: "anything mentioned or
-- shared back and forth."
--
-- Three signals get folded together:
--   1. Pursuit meetings whose attendees include people at the partner
--      (people.company_id = partner.id).
--   2. Pursuit commitments tagged to the partner via either company_id
--      or a fuzzy company-name match (commitments.company ILIKE name).
--   3. Pursuit items that came from a partner-attended meeting.
--
-- Returns one row per pursuit with a per-channel breakdown so the UI can
-- show "5 touches: 2 meetings, 3 commitments" rather than a flat number.

create or replace function get_partner_joint_pursuits(
  partner_id uuid,
  searching_user_id uuid,
  max_results int default 20
)
returns table (
  pursuit_id uuid,
  pursuit_name text,
  pursuit_status text,
  touch_count int,
  via_meetings int,
  via_commitments int,
  via_items int,
  most_recent_touch timestamptz
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
    -- People at the partner (for meeting attendance signal)
    partner_people as (
      select pe.id
      from people pe
      where pe.user_id = searching_user_id
        and pe.company_id = (select id from partner)
    ),
    -- Meetings the partner attended
    partner_meetings as (
      select distinct ma.meeting_id as id
      from meeting_attendees ma
      where ma.person_id in (select id from partner_people)
    ),
    -- Commitments tagged to the partner. Match on the structured
    -- company_id link first, then fall back to fuzzy name match for
    -- rows where the canonical link wasn't set.
    partner_commitments as (
      select co.id
      from commitments co
      where co.user_id = searching_user_id
        and (
          co.company_id = (select id from partner)
          or co.company ilike '%' || (select name from partner) || '%'
        )
    ),
    -- Items born from a partner-attended meeting (best proxy for "item
    -- that came out of a joint conversation"). Items don't have their
    -- own partner field, so this is the cleanest signal available.
    partner_items as (
      select i.id
      from items i
      where i.user_id = searching_user_id
        and i.source_meeting_id in (select id from partner_meetings)
    ),
    -- Fold all three channels through pursuit_members. Each row is one
    -- (pursuit, channel) touch; we aggregate per pursuit below.
    pursuit_touches as (
      select pm.pursuit_id, pm.member_type
      from pursuit_members pm
      where
        (pm.member_type = 'meeting' and pm.member_id in (select id from partner_meetings))
        or (pm.member_type = 'commitment' and pm.member_id in (select id from partner_commitments))
        or (pm.member_type = 'item' and pm.member_id in (select id from partner_items))
    )
  select
    p.id as pursuit_id,
    p.name as pursuit_name,
    p.status as pursuit_status,
    count(*)::int as touch_count,
    count(*) filter (where pt.member_type = 'meeting')::int as via_meetings,
    count(*) filter (where pt.member_type = 'commitment')::int as via_commitments,
    count(*) filter (where pt.member_type = 'item')::int as via_items,
    p.updated_at as most_recent_touch
  from pursuit_touches pt
  join pursuits p on p.id = pt.pursuit_id
  where p.user_id = searching_user_id
  group by p.id, p.name, p.status, p.updated_at
  -- Active pursuits first (so "what's still open" is visually top), then
  -- by touch volume, then by recency.
  order by
    case when p.status = 'active' then 0 else 1 end,
    count(*) desc,
    p.updated_at desc
  limit greatest(1, least(coalesce(max_results, 20), 100));
end;
$$;

revoke execute on function get_partner_joint_pursuits(uuid, uuid, int) from public, anon;
grant execute on function get_partner_joint_pursuits(uuid, uuid, int) to authenticated, service_role;
