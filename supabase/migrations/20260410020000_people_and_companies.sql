-- People & Companies: canonical identity layer.
--
-- Normalizes the free-text names, emails, and company strings scattered
-- across meetings.attendees, commitments.counterpart, pursuits.company,
-- and items.custom_fields.company into proper relational tables.
--
-- Strategy: add FK columns alongside existing text fields (gradual migration).
-- Ingest functions resolve people/companies on write; existing text fields
-- remain for backwards compatibility and full-text search.

-- ============================================================
-- Companies
-- ============================================================

create table companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,

  name text not null,                  -- canonical display name: "EPAM", "Adobe"
  aliases text[] default '{}',         -- alternate forms: ["EPAM Systems", "epam.com"]
  domain text,                         -- primary email domain: "epam.com"
  notes text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index idx_companies_user_name_lower on companies(user_id, lower(name));
create index idx_companies_user on companies(user_id);

alter table companies enable row level security;
create policy "Users can manage own companies"
  on companies for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_companies_updated_at
  before update on companies
  for each row execute function update_updated_at();

alter publication supabase_realtime add table companies;

-- ============================================================
-- People
-- ============================================================

create table people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,

  name text not null,                  -- canonical display name: "Holly Quinones"
  email text,                          -- primary email
  aliases text[] default '{}',         -- alternate names/emails: ["Holly", "holly_quinones@epam.com"]
  company_id uuid references companies(id) on delete set null,
  role text,                           -- job title / function
  notes text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index idx_people_user_name_lower on people(user_id, lower(name));
create index idx_people_user on people(user_id);
create index idx_people_company on people(company_id) where company_id is not null;
create unique index idx_people_user_email on people(user_id, lower(email)) where email is not null;

alter table people enable row level security;
create policy "Users can manage own people"
  on people for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_people_updated_at
  before update on people
  for each row execute function update_updated_at();

alter publication supabase_realtime add table people;

-- ============================================================
-- Meeting ↔ Person junction (replaces text[] attendees over time)
-- ============================================================

create table meeting_attendees (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings(id) on delete cascade not null,
  person_id uuid references people(id) on delete cascade not null,
  added_at timestamptz default now(),
  unique (meeting_id, person_id)
);

create index idx_meeting_attendees_meeting on meeting_attendees(meeting_id);
create index idx_meeting_attendees_person on meeting_attendees(person_id);

alter table meeting_attendees enable row level security;
create policy "Users can manage own meeting attendees"
  on meeting_attendees for all
  using (exists (
    select 1 from meetings m where m.id = meeting_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from meetings m where m.id = meeting_id and m.user_id = auth.uid()
  ));

-- ============================================================
-- FK columns on existing tables (alongside existing text fields)
-- ============================================================

-- Pursuits: company_id alongside text company
alter table pursuits add column company_id uuid references companies(id) on delete set null;
create index idx_pursuits_company on pursuits(company_id) where company_id is not null;

-- Commitments: person_id (counterpart) and company_id alongside text fields
alter table commitments add column person_id uuid references people(id) on delete set null;
alter table commitments add column company_id uuid references companies(id) on delete set null;
create index idx_commitments_person on commitments(person_id) where person_id is not null;
create index idx_commitments_company on commitments(company_id) where company_id is not null;

-- Items: company_id (replaces custom_fields.company over time)
alter table items add column company_id uuid references companies(id) on delete set null;
create index idx_items_company on items(company_id) where company_id is not null;
