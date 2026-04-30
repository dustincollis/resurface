-- Lock down webhook_payload_log.
--
-- The original migration (20260413100000_webhook_log.sql) said
-- "service-role access only, no RLS needed" — but that's only true if no
-- client has the anon key. The anon key is public-ish (embedded in the
-- frontend bundle, intentionally), so without RLS, anyone hitting the
-- /rest/v1/ endpoint with the anon key can read every row.
--
-- Confirmed exploitable as of 2026-04-30: anon key + public URL returned
-- live rows from this table.
--
-- Fix: enable RLS with no policies. Service role bypasses RLS, so the
-- jamie-webhook function (which writes here) keeps working unchanged.
-- Belt-and-suspenders: revoke client-role grants too, so the table
-- doesn't even appear via REST as queryable.

alter table webhook_payload_log enable row level security;

revoke all on table webhook_payload_log from anon, authenticated;

-- No CREATE POLICY statements. Without policies, RLS denies everything
-- except service role — which is the entire intent.
