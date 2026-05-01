-- Async generation for theme_reports.
--
-- The analysis runs Opus 4.7 with adaptive thinking over the full corpus,
-- which can take 90s+ on a deep run. The Supabase Edge Function gateway
-- times out before that and returns 504 to the client even though the
-- function itself can still complete. To fix: insert a stub row up front,
-- return it to the client immediately, run the AI call in the background
-- (EdgeRuntime.waitUntil), and update the same row when the analysis is
-- ready. The client polls or subscribes until status flips.
--
-- Same shape as morning_briefings.status.

alter table theme_reports
  add column status text not null default 'ready'
    check (status in ('generating', 'ready', 'failed')),
  add column error_text text;

create index idx_theme_reports_user_status
  on theme_reports(user_id, status, created_at desc);
