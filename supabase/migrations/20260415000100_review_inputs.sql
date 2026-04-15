-- Review Inputs: manually-captured snippets (emails, screenshots, pasted
-- text) that should get the same action-item extraction treatment as
-- meetings. Each input produces zero-or-more proposals via the
-- ai-parse-input edge function.
--
-- Storage convention for screenshots: uploaded to the existing `transcripts`
-- storage bucket under `<user_id>/inputs/<uuid>.<ext>` (the bucket's RLS
-- policy already scopes to user-owned folders).

create table inputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,

  input_type text not null check (input_type in (
    'email', 'screenshot', 'pasted_text'
  )),

  -- Display title. Derived at creation time from: email Subject header,
  -- first line of pasted text, or "Screenshot from <date>".
  title text not null,

  -- User-supplied description / context note ("this is from Brian about
  -- the Mars deal"). Passed to the parser alongside the raw content.
  user_description text,

  -- Raw text content for emails + pasted text. Null for screenshots.
  raw_text text,

  -- Storage path for screenshots. Null for email/pasted_text.
  storage_path text,

  -- Content-type of the screenshot (image/png, image/jpeg, etc.). Kept so
  -- the edge function can build the right Claude media_type without
  -- re-sniffing the file.
  mime_type text,

  -- Lightweight metadata -- email from/to/date, screenshot source hint,
  -- etc. Kept loose; the parser reads what's there.
  metadata jsonb not null default '{}'::jsonb,

  processed_at timestamptz,
  processing_error text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_inputs_user_created on inputs(user_id, created_at desc);
create index idx_inputs_unprocessed on inputs(user_id, created_at desc)
  where processed_at is null;

alter table inputs enable row level security;
create policy "Users can manage own inputs"
  on inputs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_inputs_updated_at
  before update on inputs
  for each row execute function update_updated_at();

alter publication supabase_realtime add table inputs;

-- Extend proposals.source_type to include 'input'. Proposals extracted
-- from a review input set source_type='input' and source_id=inputs.id.
alter table proposals drop constraint proposals_source_type_check;
alter table proposals add constraint proposals_source_type_check check (
  source_type in ('meeting', 'transcript', 'chat', 'manual', 'reconciliation', 'input')
);
