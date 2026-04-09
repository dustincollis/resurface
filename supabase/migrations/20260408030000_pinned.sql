-- Add pin support: manually promote an item to Today's Focus
-- regardless of its computed priority score

alter table items
  add column pinned boolean default false not null;

create index idx_items_pinned on items(user_id, pinned) where pinned = true;
