-- Entity Momentum snapshots.
--
-- Stores weekly mention counts for top people and companies so the Momentum
-- utility page reads a cheap snapshot instead of recomputing entity mentions
-- on every load.

create table if not exists utility_entity_momentum (
  user_id uuid references profiles(id) on delete cascade not null,
  entity_type text not null check (entity_type in ('person', 'company')),
  entity_id uuid not null,
  entity_name text not null,
  total_mentions int not null,
  weekly_counts int[] not null,
  refreshed_at timestamptz not null default now(),

  primary key (user_id, entity_type, entity_id)
);

create index if not exists idx_utility_entity_momentum_user_total
  on utility_entity_momentum(user_id, total_mentions desc);

alter table utility_entity_momentum enable row level security;

drop policy if exists "Users can read own entity momentum"
  on utility_entity_momentum;

create policy "Users can read own entity momentum"
  on utility_entity_momentum for select
  using (auth.uid() = user_id);

grant select on utility_entity_momentum to authenticated;

alter publication supabase_realtime add table utility_entity_momentum;

create or replace function compute_entity_momentum(
  searching_user_id uuid,
  weeks int default 12,
  top_n int default 30
)
returns table (
  entity_type text,
  entity_id uuid,
  entity_name text,
  total_mentions int,
  weekly_counts int[]
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with
  bounds as (
    select
      date_trunc('week', now()) as current_week,
      date_trunc('week', now()) - ((weeks - 1) * interval '1 week') as window_start,
      now() as window_end
  ),
  week_series as (
    select
      gs.i,
      b.current_week - ((weeks - 1 - gs.i) * interval '1 week') as week_start
    from bounds b
    cross join generate_series(0, weeks - 1) as gs(i)
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
      and lower(p.name) = lower(i.originated_by)
    where i.created_at >= b.window_start
      and i.created_at <= b.window_end
      and i.originated_by is not null

    union all

    select
      p.id as entity_id,
      p.name as entity_name,
      c.created_at as mentioned_at
    from bounds b
    join commitments c on c.user_id = searching_user_id
    join people p on p.id = c.person_id and p.user_id = searching_user_id
    where c.created_at >= b.window_start
      and c.created_at <= b.window_end

    union all

    select
      p.id as entity_id,
      p.name as entity_name,
      c.created_at as mentioned_at
    from bounds b
    join commitments c on c.user_id = searching_user_id
    join people p on p.user_id = searching_user_id
      and lower(p.name) = lower(c.counterpart)
    where c.created_at >= b.window_start
      and c.created_at <= b.window_end
      and c.counterpart is not null
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
    join companies c on c.id = i.company_id and c.user_id = searching_user_id
    where i.created_at >= b.window_start
      and i.created_at <= b.window_end

    union all

    select
      c.id as entity_id,
      c.name as entity_name,
      i.created_at as mentioned_at
    from bounds b
    join ideas i on i.user_id = searching_user_id
    join companies c on c.user_id = searching_user_id
      and lower(c.name) = lower(i.company_name)
    where i.created_at >= b.window_start
      and i.created_at <= b.window_end
      and i.company_name is not null

    union all

    select
      c.id as entity_id,
      c.name as entity_name,
      co.created_at as mentioned_at
    from bounds b
    join commitments co on co.user_id = searching_user_id
    join companies c on c.id = co.company_id and c.user_id = searching_user_id
    where co.created_at >= b.window_start
      and co.created_at <= b.window_end

    union all

    select
      c.id as entity_id,
      c.name as entity_name,
      co.created_at as mentioned_at
    from bounds b
    join commitments co on co.user_id = searching_user_id
    join companies c on c.user_id = searching_user_id
      and lower(c.name) = lower(co.company)
    where co.created_at >= b.window_start
      and co.created_at <= b.window_end
      and co.company is not null
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
  weekly_mentions as (
    select
      am.mention_entity_type,
      am.entity_id,
      am.entity_name,
      date_trunc('week', am.mentioned_at) as week_start,
      count(*)::int as mentions
    from all_mentions am
    group by
      am.mention_entity_type,
      am.entity_id,
      am.entity_name,
      date_trunc('week', am.mentioned_at)
  ),
  totals as (
    select
      wm.mention_entity_type,
      wm.entity_id,
      wm.entity_name,
      sum(wm.mentions)::int as total_mentions
    from weekly_mentions wm
    group by wm.mention_entity_type, wm.entity_id, wm.entity_name
  ),
  top_entities as (
    select *
    from totals
    order by total_mentions desc, entity_name asc
    limit top_n
  )
  select
    te.mention_entity_type as entity_type,
    te.entity_id,
    te.entity_name,
    te.total_mentions,
    array_agg(coalesce(wm.mentions, 0) order by ws.i)::int[] as weekly_counts
  from top_entities te
  cross join week_series ws
  left join weekly_mentions wm
    on wm.mention_entity_type = te.mention_entity_type
    and wm.entity_id = te.entity_id
    and wm.week_start = ws.week_start
  group by
    te.mention_entity_type,
    te.entity_id,
    te.entity_name,
    te.total_mentions
  order by te.total_mentions desc, te.entity_name asc;
$$;

revoke all on function compute_entity_momentum(uuid, int, int) from public;

create or replace function get_entity_momentum(
  searching_user_id uuid,
  weeks int default 12,
  top_n int default 30
)
returns table (
  entity_type text,
  entity_id uuid,
  entity_name text,
  total_mentions int,
  weekly_counts int[]
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
  select *
  from compute_entity_momentum(searching_user_id, weeks, top_n);
end;
$$;

revoke all on function get_entity_momentum(uuid, int, int) from public;
grant execute on function get_entity_momentum(uuid, int, int) to authenticated, service_role;

create or replace function refresh_entity_momentum_for_user(
  p_user_id uuid,
  weeks int default 12,
  top_n int default 30
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count int;
begin
  delete from utility_entity_momentum
  where user_id = p_user_id;

  insert into utility_entity_momentum (
    user_id,
    entity_type,
    entity_id,
    entity_name,
    total_mentions,
    weekly_counts,
    refreshed_at
  )
  select
    p_user_id,
    m.entity_type,
    m.entity_id,
    m.entity_name,
    m.total_mentions,
    m.weekly_counts,
    now()
  from compute_entity_momentum(p_user_id, weeks, top_n) m;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function refresh_entity_momentum_for_user(uuid, int, int) from public;
grant execute on function refresh_entity_momentum_for_user(uuid, int, int) to service_role;

create or replace function refresh_all_entity_momentum()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p record;
  total_count int := 0;
begin
  for p in select id from profiles loop
    total_count := total_count + refresh_entity_momentum_for_user(p.id);
  end loop;

  return total_count;
end;
$$;

revoke all on function refresh_all_entity_momentum() from public;
grant execute on function refresh_all_entity_momentum() to service_role;

create extension if not exists pg_cron with schema extensions;

do $$
begin
  perform cron.unschedule('utility-entity-momentum-refresh');
exception when others then null;
end $$;

select
  cron.schedule(
    'utility-entity-momentum-refresh',
    '20 10 * * *',
    $cron$
    select refresh_all_entity_momentum();
    $cron$
  );

select refresh_all_entity_momentum();
