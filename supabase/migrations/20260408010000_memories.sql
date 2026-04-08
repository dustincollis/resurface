-- Memories: discrete facts the AI knows about the user
-- Combined with profile.settings.bio_distilled to form the AI's user context

create table memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  content text not null,
  source text default 'user_added' check (source in (
    'user_added', 'extracted_from_chat', 'extracted_from_transcript', 'extracted_from_item'
  )),
  created_at timestamptz default now()
);

create index idx_memories_user_time on memories(user_id, created_at desc);

alter table memories enable row level security;
create policy "Users can manage own memories"
  on memories for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
