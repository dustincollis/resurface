-- Schedule the compute-staleness edge function to run hourly
-- Requires pg_cron and pg_net extensions (Supabase auto-enables these on request)

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Drop any existing schedule with this name to make the migration idempotent
do $$
begin
  perform cron.unschedule('compute-staleness-hourly');
exception when others then
  -- ignore: schedule didn't exist
  null;
end $$;

-- Schedule hourly: every hour at minute 0
select
  cron.schedule(
    'compute-staleness-hourly',
    '0 * * * *',
    $cron$
    select net.http_post(
      url := 'https://biapwycemhtdhcpmgshp.supabase.co/functions/v1/compute-staleness',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    ) as request_id;
    $cron$
  );
