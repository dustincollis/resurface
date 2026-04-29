-- Follow-Ups: post-meeting relational closing moves. The "thanks Beth, here
-- are the numbers I'll get back to you on" message that gets dropped when
-- the day is back-to-back. Distinct from commitments (which span weeks
-- and have deliverables) and tasks (which are the work itself). A
-- follow-up is the *acknowledgment* that the work exists.
--
-- Lifecycle:
--   pending  -- AI extracted, not sent
--   sent     -- every recipient has been stamped sent_at
--   dismissed -- user gave up on this one
--
-- Recipients live as jsonb (small cardinality, always read/written as a
-- unit). Each recipient carries its own draft body + sent_at so the user
-- can mark addressees individually. Whole follow-up rolls up to 'sent'
-- when every recipient has sent_at populated.
--
-- AI writes here directly (no proposal-queue round trip), mirroring the
-- memories table pattern. Source meeting linkage is mandatory; the
-- follow-up never makes sense without the conversation it came from.

create table follow_ups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,

  -- The discussion this follow-up belongs to. Always required.
  source_meeting_id uuid references meetings(id) on delete cascade not null,

  status text not null default 'pending' check (status in (
    'pending', 'sent', 'dismissed'
  )),

  -- Why the AI thinks this meeting warrants a follow-up at all
  -- (one short sentence, shown on the card as context).
  rationale text,

  -- Verbatim transcript snippet that justified the follow-up
  -- (evidence-first, same pattern as proposals).
  evidence_text text,

  -- Recipient drafts. Each entry:
  --   {
  --     "name": "Beth Smith",
  --     "email": "beth@example.com" | null,
  --     "person_id": "uuid" | null,
  --     "draft_subject": "Following up on contract numbers",
  --     "draft_body": "Hi Beth, ...",
  --     "rationale": "Beth ran the meeting and is awaiting the numbers",
  --     "sent_at": "2026-04-29T15:30:00Z" | null
  --   }
  -- Most meetings produce one entry; sometimes a few when distinct
  -- audiences need different content.
  recipients jsonb not null default '[]'::jsonb,

  -- AI's confidence that a follow-up is warranted (0..1).
  ai_confidence float,

  -- User-added note before sending (rarely used, but cheap to support).
  notes text,

  created_at timestamptz not null default now(),
  sent_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index idx_follow_ups_user_pending on follow_ups(user_id, created_at desc)
  where status = 'pending';
create index idx_follow_ups_user_created on follow_ups(user_id, created_at desc);
create index idx_follow_ups_source_meeting on follow_ups(source_meeting_id);

alter table follow_ups enable row level security;

create policy "Users can manage own follow_ups"
  on follow_ups for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_follow_ups_updated_at
  before update on follow_ups
  for each row execute function update_updated_at();

alter publication supabase_realtime add table follow_ups;
