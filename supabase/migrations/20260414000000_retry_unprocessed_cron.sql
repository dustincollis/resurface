-- Schedule retry-unprocessed to run every 5 minutes.
-- Picks up meetings that have a transcript but no processed_at stamp,
-- e.g. when the Jamie-webhook fire-and-forget parse died mid-flight.
-- Without this cron, a failed background parse leaves the meeting
-- permanently "pending" in the UI.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule('retry-unprocessed-every-5min');
exception when others then
  null;
end $$;

select
  cron.schedule(
    'retry-unprocessed-every-5min',
    '*/5 * * * *',
    $cron$
    select net.http_post(
      url := 'https://biapwycemhtdhcpmgshp.supabase.co/functions/v1/retry-unprocessed',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    ) as request_id;
    $cron$
  );
