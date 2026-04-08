-- Add snooze support to items
-- When set, items are filtered out of Today's Focus until the timestamp passes

alter table items
  add column snoozed_until timestamptz;

create index idx_items_snoozed on items(user_id, snoozed_until);
