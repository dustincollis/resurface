-- Going Quiet only needs daily freshness. Threads move on a days-silent
-- timescale, so hourly refreshes are unnecessary database churn.

create extension if not exists pg_cron with schema extensions;

do $$
begin
  perform cron.unschedule('utility-quiet-threads-refresh');
exception when others then null;
end $$;

select
  cron.schedule(
    'utility-quiet-threads-refresh',
    '15 10 * * *',
    $cron$
    select refresh_all_quiet_threads();
    $cron$
  );
