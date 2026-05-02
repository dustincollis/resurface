-- Fire-and-forget write-time embedding for the four Similar corpus tables.
-- If the edge function is unavailable, rows remain unembedded and the
-- service-role backfill can pick them up later.

create extension if not exists pg_net with schema extensions;

create or replace function request_corpus_embedding()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.embedding is null then
    perform net.http_post(
      url := 'https://biapwycemhtdhcpmgshp.supabase.co/functions/v1/embed-corpus',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object(
        'mode', 'single',
        'table', tg_table_name,
        'id', new.id::text
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists embed_ideas_after_insert on ideas;
create trigger embed_ideas_after_insert
  after insert on ideas
  for each row execute function request_corpus_embedding();

drop trigger if exists embed_memories_after_insert on memories;
create trigger embed_memories_after_insert
  after insert on memories
  for each row execute function request_corpus_embedding();

drop trigger if exists embed_commitments_after_insert on commitments;
create trigger embed_commitments_after_insert
  after insert on commitments
  for each row execute function request_corpus_embedding();

drop trigger if exists embed_meetings_after_insert on meetings;
create trigger embed_meetings_after_insert
  after insert on meetings
  for each row execute function request_corpus_embedding();
