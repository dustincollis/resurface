-- Follow-ups model fix: a follow-up is ONE email, not N parallel emails.
--
-- The original schema put draft_subject and draft_body on each recipient,
-- assuming each addressee gets their own customized message. But the user's
-- actual style is to greet everyone by name in a single email ("Hey Bob,
-- Sue, and Mary,") or "Hey All," for larger groups -- never to single out
-- one attendee from a multi-person call.
--
-- This migration:
--   1. Moves draft_subject + draft_body up to the follow_ups row
--   2. Backfills from recipients[0] for any existing rows
--   3. Strips draft_subject/draft_body/sent_at from each recipient entry,
--      leaving only addressee info (name, email, person_id, rationale)
--   4. Adds the row-level sent_at logic in code (one click marks sent;
--      partial-send state goes away because there's only one send)

alter table follow_ups
  add column draft_subject text,
  add column draft_body text;

-- Backfill existing rows: take the first recipient's draft, hoist it up.
-- Strip the per-recipient draft fields so the jsonb shape matches the new
-- model.
update follow_ups
set
  draft_subject = coalesce(
    (recipients -> 0 ->> 'draft_subject'),
    'Following up'
  ),
  draft_body = coalesce(
    (recipients -> 0 ->> 'draft_body'),
    ''
  ),
  recipients = (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', r ->> 'name',
          'email', r ->> 'email',
          'person_id', r ->> 'person_id',
          'rationale', r ->> 'rationale'
        )
      ),
      '[]'::jsonb
    )
    from jsonb_array_elements(recipients) r
  )
where draft_body is null;

-- Once backfilled, draft_body should be required on new rows.
alter table follow_ups
  alter column draft_subject set default 'Following up',
  alter column draft_subject set not null,
  alter column draft_body set default '',
  alter column draft_body set not null;
