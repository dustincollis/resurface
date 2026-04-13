-- webhook_payload_log: raw webhook payloads for disaster recovery.
-- Insert-only, service-role access only. No RLS needed.
create table webhook_payload_log (
  id               uuid primary key default gen_random_uuid(),
  source           text not null,
  external_source_id text,
  payload          jsonb not null,
  http_status      smallint,
  meeting_id       uuid,
  error            text,
  created_at       timestamptz default now()
);

create index idx_webhook_log_source_time on webhook_payload_log(source, created_at desc);
create index idx_webhook_log_external_id on webhook_payload_log(external_source_id)
  where external_source_id is not null;
