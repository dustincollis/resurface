-- Scope chat messages so they can be threaded per item (or per anything
-- else in the future). The existing global sidebar chat keeps working
-- with scope_type='global'; new inline item chats use scope_type='item'
-- with scope_id pointing at the item.

alter table public.chat_messages
  add column scope_type text not null default 'global'
    check (scope_type in ('global', 'item')),
  add column scope_id uuid;

create index idx_chat_messages_user_scope_time
  on public.chat_messages(user_id, scope_type, scope_id, created_at);
