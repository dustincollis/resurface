-- Tracking flag on items: when true, the item is something the user is
-- observing (not their own work). Tracked items live on pursuit pages
-- but don't appear in Today's Focus and don't accumulate staleness.

alter table public.items
  add column tracking boolean not null default false;
