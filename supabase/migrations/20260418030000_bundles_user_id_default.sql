-- Set user_id default to auth.uid() on bundles so the frontend never
-- needs to pass it explicitly. RLS with check (auth.uid() = user_id)
-- is always satisfied when the default is used.
alter table bundles alter column user_id set default auth.uid();
