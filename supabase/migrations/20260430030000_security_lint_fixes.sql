-- Clear the Supabase Database Linter "WARN/SECURITY" findings flagged on
-- 2026-04-30. Three classes of fix in one migration:
--
-- 1. function_search_path_mutable — set explicit search_path on functions
--    that don't already have one. Without this, a SECURITY DEFINER function
--    can be tricked into resolving an attacker-created object first if the
--    caller's role can write to a schema earlier in the path. Setting an
--    explicit search_path closes that vector.
--
-- 2. anon_security_definer_function_executable — handle_new_user is an
--    auth trigger, not an RPC. Revoke the public REST entry point so it
--    can't be invoked via /rest/v1/rpc/handle_new_user. The trigger keeps
--    working because triggers run as the function's owner, not as the
--    role calling the table operation.
--
-- 3. anon_security_definer_function_executable on search_* — these are
--    intentionally REST-callable for the frontend search UI, but only
--    for signed-in users. Revoke EXECUTE from `anon` so signed-out
--    callers can't hit them.
--
-- Two warnings are intentionally NOT addressed here:
--   - extension_in_public (pg_trgm, vector): moving extensions on an
--     existing project requires DROP EXTENSION ... CASCADE which drops
--     every dependent index (we have GIN trigram + pgvector indexes).
--     Standard Supabase guidance for existing projects: leave alone.
--   - auth_leaked_password_protection: dashboard toggle, not a code fix.
--
-- Latent issue NOT addressed here (deferred until multi-user):
--   The search_* functions accept `searching_user_id` / `p_user_id` as a
--   parameter and trust it because they run SECURITY DEFINER. With a
--   valid JWT, an authenticated caller could RPC them with another user's
--   ID and read that user's data. Today this is moot (single user). When
--   multi-user is enabled, add `if auth.uid() <> searching_user_id then
--   raise exception 'forbidden' end if;` to each function body, OR move
--   them behind an Edge Function that verifies caller identity.

-- 1) Pin search_path on functions that don't have it set
alter function public.update_updated_at() set search_path = public, pg_temp;
alter function public.search_everything(text, uuid, integer) set search_path = public, pg_temp;
alter function public.search_meeting_chunks(public.vector, uuid, integer, double precision) set search_path = public, pg_temp;
alter function public.search_bundle_chunks(uuid, uuid, public.vector, text, integer, double precision) set search_path = public, pg_temp;

-- 2) handle_new_user should not be invokable via REST. The trigger that
--    references it (on auth.users insert) is unaffected — triggers run as
--    the function's owner regardless of EXECUTE grants.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 3) Search functions are for signed-in users only. Revoke anon access;
--    keep `authenticated` so the frontend's logged-in users can still
--    search.
revoke execute on function public.search_everything(text, uuid, integer) from anon;
revoke execute on function public.search_meeting_chunks(public.vector, uuid, integer, double precision) from anon;
revoke execute on function public.search_bundle_chunks(uuid, uuid, public.vector, text, integer, double precision) from anon;
