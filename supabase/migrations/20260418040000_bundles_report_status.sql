-- Track async report generation status so the edge function can return
-- immediately and do the two-pass work in the background via
-- EdgeRuntime.waitUntil. Frontend polls report_status to refetch when ready.

alter table bundles
  add column if not exists report_status text not null default 'idle'
    check (report_status in ('idle', 'generating', 'ready', 'failed')),
  add column if not exists report_error text,
  add column if not exists report_started_at timestamptz;
