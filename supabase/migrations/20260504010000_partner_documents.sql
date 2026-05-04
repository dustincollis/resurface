-- Partner reference documents — org charts, team-alignment decks,
-- capability briefs, contract structures. These are different from
-- meetings: long-lived reference material the user wants attached to a
-- partner so the partner page has real depth and AI calls about that
-- partner can pull relevant snippets as context.
--
-- Stored once per upload. The processing pipeline (Edge Function
-- process-partner-document) extracts text, asks Claude for a short
-- summary and a structured list of people/accounts named in the doc,
-- and uses the existing identity resolver to upsert people rows tied
-- to the partner — same path meeting parsing already uses, so the
-- partner roster on /companies/:id stays a single source of truth.

create table partner_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  company_id uuid references companies(id) on delete cascade not null,

  -- Display
  title text not null,
  kind text not null default 'other' check (kind in (
    'org_chart', 'team_structure', 'capability_brief', 'contract', 'other'
  )),

  -- File
  original_filename text not null,
  mime_type text not null,
  storage_path text not null,
  size_bytes int,

  -- Extraction outputs (populated by process-partner-document)
  extracted_text text,
  summary text,
  -- Structured people identified by Claude. Each entry: { name, role,
  -- territory, region, email, notes }. The processor also calls the
  -- identity resolver to upsert real `people` rows for each one, so this
  -- field is mainly for traceability ("which doc said what about whom").
  extracted_people jsonb not null default '[]'::jsonb,
  -- Accounts mentioned in the doc — useful for partner activity context
  -- and future "this doc references Walmart" cross-linking.
  extracted_accounts jsonb not null default '[]'::jsonb,

  -- Processing state
  processed_at timestamptz,
  processing_error text,

  -- Timestamps
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_partner_documents_company on partner_documents(company_id, uploaded_at desc);
create index idx_partner_documents_user on partner_documents(user_id, uploaded_at desc);
create index idx_partner_documents_unprocessed on partner_documents(user_id)
  where processed_at is null and processing_error is null;

alter table partner_documents enable row level security;
create policy "Users can manage own partner documents"
  on partner_documents for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Storage bucket — private, mirrors the existing `transcripts` bucket
-- pattern. Path convention: {user_id}/{company_id}/{uuid}-{filename}.
insert into storage.buckets (id, name, public)
values ('partner-docs', 'partner-docs', false)
on conflict (id) do nothing;

create policy "Users can read own partner docs"
  on storage.objects for select
  using (
    bucket_id = 'partner-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can upload to own partner docs folder"
  on storage.objects for insert
  with check (
    bucket_id = 'partner-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own partner docs"
  on storage.objects for delete
  using (
    bucket_id = 'partner-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
