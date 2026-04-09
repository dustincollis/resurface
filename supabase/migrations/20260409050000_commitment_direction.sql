-- Direction on commitments: outgoing (you owe) vs incoming (owed to you).
-- Defaults to 'outgoing' so existing rows preserve their meaning.
-- Incoming commitments capture "Holly is sending me the contract Friday" —
-- things others promised that the user wants to track without putting on
-- their own to-do list.

alter table public.commitments
  add column direction text not null default 'outgoing'
    check (direction in ('outgoing', 'incoming'));

create index idx_commitments_user_dir_status on commitments(user_id, direction, status, do_by nulls last);
