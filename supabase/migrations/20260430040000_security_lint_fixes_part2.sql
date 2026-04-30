-- Follow-up to 20260430030000. The previous migration revoked EXECUTE on
-- the search_* functions "from anon" and on handle_new_user "from anon,
-- authenticated", but functions default-grant EXECUTE to PUBLIC, and
-- both anon and authenticated inherit via PUBLIC. So the revoke was
-- effectively a no-op (verified via curl: anon could still call
-- /rest/v1/rpc/search_everything and got results back).
--
-- Correct pattern: revoke from PUBLIC first (which removes the implicit
-- grant to all roles), then explicitly GRANT to the roles that should
-- have it. This is the Postgres-standard hardening pattern.

-- handle_new_user: nobody should call it via RPC. The trigger keeps
-- working because triggers don't check EXECUTE on the function body,
-- they run as the function's owner.
revoke execute on function public.handle_new_user() from public;

-- search_*: revoke from PUBLIC, then grant to authenticated only.
-- Service role bypasses these grants (it's a superuser-equivalent).
revoke execute on function public.search_everything(text, uuid, integer) from public;
grant execute on function public.search_everything(text, uuid, integer) to authenticated;

revoke execute on function public.search_meeting_chunks(public.vector, uuid, integer, double precision) from public;
grant execute on function public.search_meeting_chunks(public.vector, uuid, integer, double precision) to authenticated;

revoke execute on function public.search_bundle_chunks(uuid, uuid, public.vector, text, integer, double precision) from public;
grant execute on function public.search_bundle_chunks(uuid, uuid, public.vector, text, integer, double precision) to authenticated;
