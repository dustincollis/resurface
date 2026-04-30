-- Pre-warm the morning briefing at 6am Eastern (10:00 UTC during EDT;
-- 11:00 UTC during EST). Schedule both so a briefing exists by 6am the
-- user's local time year-round; the second call is a cheap snapshot
-- read because of the unique (user_id, briefing_date) constraint.
--
-- Calls without an Authorization header (matches existing cron patterns
-- for compute-staleness and retry-unprocessed). The edge function falls
-- back to RESURFACE_DEFAULT_USER_ID when no auth is provided. Worst case:
-- an unauthenticated caller triggers a regen for the default user (auto-
-- deduped, ~$0.02 cost per regen, no data exposure).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Idempotency
do $$
begin
  perform cron.unschedule('morning-briefing-prewarm-edt');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('morning-briefing-prewarm-est');
exception when others then null;
end $$;

-- 10:00 UTC = 6:00 EDT (March-November)
select
  cron.schedule(
    'morning-briefing-prewarm-edt',
    '0 10 * * *',
    $cron$
    select net.http_post(
      url := 'https://biapwycemhtdhcpmgshp.supabase.co/functions/v1/generate-morning-briefing',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    ) as request_id;
    $cron$
  );

-- 11:00 UTC = 6:00 EST (November-March). Second call is essentially free —
-- the function returns the existing snapshot if one exists for today.
select
  cron.schedule(
    'morning-briefing-prewarm-est',
    '0 11 * * *',
    $cron$
    select net.http_post(
      url := 'https://biapwycemhtdhcpmgshp.supabase.co/functions/v1/generate-morning-briefing',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    ) as request_id;
    $cron$
  );
