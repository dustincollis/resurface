-- Import mode for meetings: distinguishes live calls from archived recordings.
-- 'active' meetings parse normally (proposals get created from action items).
-- 'archive' meetings still get summarized, decisions, and open questions —
-- but proposal creation is suppressed so old recordings don't pollute the
-- review queue with stale "commitments".

alter table meetings
  add column import_mode text not null default 'active'
    check (import_mode in ('active', 'archive'));

create index idx_meetings_user_mode_time on meetings(user_id, import_mode, start_time desc);
