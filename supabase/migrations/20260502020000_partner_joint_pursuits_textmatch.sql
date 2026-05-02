-- Partner joint-pursuit lens v2 — broaden the signal set.
--
-- v1 (20260502010000) only counted partners as touching a pursuit when
-- they attended pursuit meetings or had a structured company_id link on
-- pursuit commitments. That returned zero for Adobe even though the
-- partner is genuinely all over the user's work — because Adobe rarely
-- formally attends EPAM's client-anchored pursuit meetings, and only 3
-- of 154 Adobe-related commitments use the structured company_id link
-- (most use the free-text 'company' field or just mention Adobe in the
-- title/description).
--
-- The user's working definition was "anything mentioned or shared back
-- and forth." So this version also counts:
--   - Pursuit meetings whose title or transcript_summary mentions the
--     partner by name.
--   - Pursuit commitments whose title, description, or company field
--     mentions the partner.
--   - Pursuit items whose title or description mentions the partner.
--
-- Word-boundary regex prevents false positives on short partner names
-- (e.g., "AWS" matching "always"). The boundary is "anything that isn't
-- alphanumeric" before and after the partner name.

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
declare
  partner_name_pattern text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and auth.uid() is distinct from searching_user_id then
    raise exception 'forbidden';
  end if;

  -- Build a case-insensitive word-boundary regex for the partner name.
  -- Example: Adobe → '(^|[^[:alnum:]])adobe([^[:alnum:]]|$)'
  select '(^|[^[:alnum:]])' || lower(c.name) || '([^[:alnum:]]|$)'
    into partner_name_pattern
  from companies c
  where c.id = partner_id and c.user_id = searching_user_id;

  if partner_name_pattern is null then
    return;
  end if;

  return query
  with
    partner as (
      select c.id, c.name
      from companies c
      where c.id = partner_id and c.user_id = searching_user_id
    ),
    -- People at the partner (one signal for meeting attendance)
    partner_people as (
      select pe.id
      from people pe
      where pe.user_id = searching_user_id
        and pe.company_id = (select id from partner)
    ),
    -- Meetings counted as "involving" the partner: either someone from
    -- the partner attended, OR the meeting title/summary mentions the
    -- partner by name.
    partner_meetings as (
      select distinct ma.meeting_id as id
      from meeting_attendees ma
      where ma.person_id in (select id from partner_people)
      union
      select m.id
      from meetings m
      where m.user_id = searching_user_id
        and (
          coalesce(m.title, '') ~* partner_name_pattern
          or coalesce(m.transcript_summary, '') ~* partner_name_pattern
        )
    ),
    -- Commitments tagged to the partner: structured link, fuzzy company
    -- field, OR the commitment text mentions the partner.
    partner_commitments as (
      select co.id
      from commitments co
      where co.user_id = searching_user_id
        and (
          co.company_id = (select id from partner)
          or coalesce(co.company, '') ~* partner_name_pattern
          or coalesce(co.title, '') ~* partner_name_pattern
          or coalesce(co.description, '') ~* partner_name_pattern
        )
    ),
    -- Items: come from a partner-involved meeting, OR mention the partner
    -- in title/description.
    partner_items as (
      select i.id
      from items i
      where i.user_id = searching_user_id
        and (
          i.source_meeting_id in (select id from partner_meetings)
          or coalesce(i.title, '') ~* partner_name_pattern
          or coalesce(i.description, '') ~* partner_name_pattern
        )
    ),
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
  order by
    case when p.status = 'active' then 0 else 1 end,
    count(*) desc,
    p.updated_at desc
  limit greatest(1, least(coalesce(max_results, 20), 100));
end;
$$;
