-- Add 'goal' to the allowed scope_type values on chat_messages
alter table chat_messages drop constraint chat_messages_scope_type_check;
alter table chat_messages add constraint chat_messages_scope_type_check
  check (scope_type in ('global', 'item', 'goal'));
