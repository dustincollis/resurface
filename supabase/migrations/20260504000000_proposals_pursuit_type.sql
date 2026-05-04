-- Pursuit proposals: extend proposal_type to include 'pursuit'.
--
-- The parser will surface pursuit candidates from meeting transcripts
-- when an account is mentioned with concrete engagement intent ("bring
-- us in", "they want us", "joint pursuit in progress"). Each candidate
-- becomes a pending proposal that the user reviews on /proposals.
-- Accepting creates a new pursuit and links the source meeting as the
-- first member.
--
-- normalized_payload shape for pursuit proposals:
--   {
--     "name": "Suggested pursuit name",
--     "company": "DexCom",
--     "intent_signal": "they want us in",
--     "description": "Optional 1-sentence context",
--     "source_meeting_id": "uuid"
--   }
--
-- Drop + re-add since CHECK constraints can't be ALTERed in place.

alter table proposals drop constraint proposals_proposal_type_check;
alter table proposals add constraint proposals_proposal_type_check
  check (proposal_type in (
    'task', 'commitment', 'memory', 'draft', 'deadline_adjustment', 'pursuit'
  ));
