-- Resurface: Initial Schema Migration
-- Tables, indexes, RLS policies, triggers, search function, realtime

-- ============================================================
-- Extensions (already enabled via dashboard, but idempotent)
-- ============================================================
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- ============================================================
-- Tables
-- ============================================================

-- profiles: extends auth.users
create table profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  display_name text,
  settings jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- streams: user-defined work categories
create table streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  color text default '#6B7280',
  icon text default 'folder',
  sort_order int default 0,
  is_archived boolean default false,
  field_templates jsonb default '[]',
  created_at timestamptz default now()
);

-- meetings: imported from ICS + transcript uploads
create table meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  ics_uid text,
  title text not null,
  start_time timestamptz,
  end_time timestamptz,
  location text,
  attendees text[],
  transcript text,
  transcript_summary text,
  extracted_action_items jsonb default '[]',
  extracted_decisions jsonb default '[]',
  extracted_open_questions jsonb default '[]',
  source text check (source in ('ics_import', 'manual', 'transcript_upload')),
  processed_at timestamptz,
  created_at timestamptz default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(transcript_summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(transcript, '')), 'C')
  ) stored
);

-- items: core task/card entity
create table items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  stream_id uuid references streams(id) on delete set null,
  title text not null,
  description text default '',
  status text default 'open' check (status in (
    'open', 'in_progress', 'waiting', 'done', 'dropped'
  )),
  next_action text,
  resistance int check (resistance between 1 and 5),
  stakes int check (stakes between 1 and 5),
  last_touched_at timestamptz default now(),
  staleness_score float default 0,
  due_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz,
  custom_fields jsonb default '{}',
  ai_suggested_stream text,
  ai_confidence float,
  parent_id uuid references items(id) on delete set null,
  source_meeting_id uuid references meetings(id) on delete set null,
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(next_action, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(custom_fields::text, '')), 'D')
  ) stored
);

-- item_links: cross-references between items
create table item_links (
  id uuid primary key default gen_random_uuid(),
  source_item_id uuid references items(id) on delete cascade not null,
  target_item_id uuid references items(id) on delete cascade not null,
  link_type text default 'related' check (link_type in (
    'related', 'blocks', 'blocked_by', 'parent', 'follow_up'
  )),
  created_at timestamptz default now(),
  unique(source_item_id, target_item_id, link_type)
);

-- activity_log: history for staleness and AI feedback
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  item_id uuid references items(id) on delete cascade,
  action text not null,
  details jsonb default '{}',
  created_at timestamptz default now()
);

-- chat_messages: AI chat history
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  actions_taken jsonb default '[]',
  created_at timestamptz default now()
);

-- ============================================================
-- Indexes
-- ============================================================

-- items: query indexes
create index idx_items_user_status on items(user_id, status);
create index idx_items_staleness on items(user_id, staleness_score desc);
create index idx_items_stream on items(stream_id);
create index idx_items_last_touched on items(user_id, last_touched_at);

-- items: search indexes
create index idx_items_fts on items using gin(search_vector);
create index idx_items_title_trgm on items using gin(title gin_trgm_ops);
create index idx_items_desc_trgm on items using gin(description gin_trgm_ops);

-- meetings: query indexes
create index idx_meetings_user_time on meetings(user_id, start_time);
create index idx_meetings_ics_uid on meetings(user_id, ics_uid);

-- meetings: search indexes
create index idx_meetings_fts on meetings using gin(search_vector);
create index idx_meetings_title_trgm on meetings using gin(title gin_trgm_ops);

-- activity_log indexes
create index idx_activity_user_time on activity_log(user_id, created_at desc);
create index idx_activity_item on activity_log(item_id, created_at desc);

-- chat_messages indexes
create index idx_chat_user_time on chat_messages(user_id, created_at desc);

-- ============================================================
-- Row-Level Security
-- ============================================================

alter table profiles enable row level security;
create policy "Users can manage own profile"
  on profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

alter table streams enable row level security;
create policy "Users can manage own streams"
  on streams for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table items enable row level security;
create policy "Users can manage own items"
  on items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table meetings enable row level security;
create policy "Users can manage own meetings"
  on meetings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table item_links enable row level security;
create policy "Users can manage own item links"
  on item_links for all
  using (
    exists (select 1 from items where items.id = item_links.source_item_id
            and items.user_id = auth.uid())
  )
  with check (
    exists (select 1 from items where items.id = item_links.source_item_id
            and items.user_id = auth.uid())
  );

alter table activity_log enable row level security;
create policy "Users can manage own activity"
  on activity_log for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table chat_messages enable row level security;
create policy "Users can manage own chat"
  on chat_messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- Triggers
-- ============================================================

-- Auto-update updated_at on row change
create or replace function update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at();

create trigger set_items_updated_at
  before update on items
  for each row execute function update_updated_at();

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- Search Function (RPC)
-- ============================================================

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
as $$
begin
  return query

  -- Search items
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

  -- Search meetings
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

-- ============================================================
-- Realtime
-- ============================================================

alter publication supabase_realtime add table items;
alter publication supabase_realtime add table meetings;
alter publication supabase_realtime add table chat_messages;
