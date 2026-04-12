export type ItemStatus = 'open' | 'in_progress' | 'waiting' | 'done' | 'dropped'

export interface FieldTemplate {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select'
  options?: string[]
}

export interface Stream {
  id: string
  user_id: string
  name: string
  color: string
  icon: string
  sort_order: number
  is_archived: boolean
  field_templates: FieldTemplate[]
  created_at: string
}

export interface Item {
  id: string
  user_id: string
  stream_id: string | null
  title: string
  description: string
  status: ItemStatus
  next_action: string | null
  resistance: number | null
  stakes: number | null
  last_touched_at: string
  staleness_score: number
  due_date: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  custom_fields: Record<string, unknown>
  ai_suggested_stream: string | null
  ai_confidence: number | null
  parent_id: string | null
  source_meeting_id: string | null
  snoozed_until: string | null
  pinned: boolean
  tracking: boolean
  // Joined fields
  streams?: Stream | null
}

export interface ActivityLogEntry {
  id: string
  user_id: string
  item_id: string | null
  action: string
  details: Record<string, unknown>
  created_at: string
}

export interface SearchResult {
  result_type: 'item' | 'meeting'
  result_id: string
  title: string
  snippet: string
  stream_name: string | null
  status: string | null
  rank: number
}

export interface CreateItemPayload {
  title: string
  description?: string
  stream_id?: string | null
  status?: ItemStatus
  next_action?: string
  resistance?: number
  stakes?: number
  due_date?: string | null
  custom_fields?: Record<string, unknown>
  parent_id?: string | null
  source_meeting_id?: string | null
  tracking?: boolean
}

export interface UpdateItemPayload extends Partial<CreateItemPayload> {
  last_touched_at?: string
  completed_at?: string | null
}

export type LinkType = 'related' | 'blocks' | 'blocked_by' | 'parent' | 'follow_up'

export interface ItemLink {
  id: string
  source_item_id: string
  target_item_id: string
  link_type: LinkType
  created_at: string
  source_item?: Pick<Item, 'id' | 'title' | 'status'>
  target_item?: Pick<Item, 'id' | 'title' | 'status'>
}

export type ChatActionEntry =
  | string // legacy: plain text confirmation
  | { type: 'proposed_item'; title: string; description?: string; stream_name?: string | null; next_action?: string | null; due_date?: string | null }
  | { type: 'proposed_stream'; name: string; color?: string | null; icon?: string | null }
  | { type: 'updated'; item_id: string }

export interface ChatMessage {
  id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string
  actions_taken: ChatActionEntry[]
  created_at: string
}

export interface CreateStreamPayload {
  name: string
  color?: string
  icon?: string
  field_templates?: FieldTemplate[]
}

export interface UpdateStreamPayload extends Partial<CreateStreamPayload> {
  sort_order?: number
  is_archived?: boolean
}

// ============================================================
// Proposals: AI extractions awaiting user review
// ============================================================

export type ProposalType =
  | 'task'
  | 'commitment'
  | 'memory'
  | 'draft'
  | 'deadline_adjustment'

export type ProposalSourceType =
  | 'meeting'
  | 'transcript'
  | 'chat'
  | 'manual'
  | 'reconciliation'

export type ProposalStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'merged'
  | 'dismissed'

export type ProposalReviewAction =
  | 'accept'
  | 'edit'
  | 'merge'
  | 'not_actionable'
  | 'dismiss_banter'

// Payload shape for proposal_type='task'. Mirrors CreateItemPayload but
// adds the assignee/urgency hints the AI emits, and is the canonical
// shape stored in proposals.normalized_payload / accepted_payload.
export interface TaskProposalPayload {
  title: string
  description?: string
  next_action?: string | null
  due_date?: string | null
  stream_id?: string | null
  parent_id?: string | null
  source_meeting_id?: string | null
  // AI hints — not written to items directly
  assignee?: string | null
  urgency?: 'high' | 'medium' | 'low' | null
  company?: string | null
}

// Payload shape for proposal_type='commitment'. Outgoing-only for now.
export interface CommitmentProposalPayload {
  title: string
  description?: string
  counterpart?: string | null
  company?: string | null
  do_by?: string | null
  promised_by?: string | null
  needs_review_by?: string | null
  source_meeting_id?: string | null
  source_item_id?: string | null
}

// ============================================================
// Commitments — soft obligations (outgoing or incoming)
// ============================================================

export type CommitmentStatus = 'open' | 'met' | 'broken' | 'cancelled' | 'waiting' | 'historical'
export type CommitmentDirection = 'outgoing' | 'incoming'

export interface Commitment {
  id: string
  user_id: string
  title: string
  description: string | null
  counterpart: string | null
  company: string | null
  do_by: string | null
  promised_by: string | null
  needs_review_by: string | null
  status: CommitmentStatus
  direction: CommitmentDirection
  source_meeting_id: string | null
  source_item_id: string | null
  evidence_text: string | null
  confidence: number | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface CreateCommitmentPayload {
  title: string
  description?: string | null
  counterpart?: string | null
  company?: string | null
  do_by?: string | null
  promised_by?: string | null
  needs_review_by?: string | null
  status?: CommitmentStatus
  direction?: CommitmentDirection
  source_meeting_id?: string | null
  source_item_id?: string | null
  evidence_text?: string | null
  confidence?: number | null
}

export interface UpdateCommitmentPayload extends Partial<CreateCommitmentPayload> {
  completed_at?: string | null
}

// ============================================================
// Pursuits — user-flagged threads of focus
// ============================================================

export type PursuitStatus = 'active' | 'won' | 'lost' | 'archived'
export type PursuitMemberType = 'item' | 'commitment' | 'meeting'

export interface Pursuit {
  id: string
  user_id: string
  name: string
  description: string | null
  company: string | null
  status: PursuitStatus
  color: string
  sort_order: number
  template_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export type PlaybookEvidenceType = 'item' | 'commitment' | 'meeting' | 'manual'

export interface PlaybookStep {
  id: string
  pursuit_id: string
  template_step_id: string
  title: string
  sort_order: number
  evidenced: boolean
  evidenced_at: string | null
  evidence_type: PlaybookEvidenceType | null
  evidence_entity_id: string | null
  evidence_note: string | null
  created_at: string
}

export interface CreatePursuitPayload {
  name: string
  description?: string | null
  company?: string | null
  status?: PursuitStatus
  color?: string
  sort_order?: number
}

export interface UpdatePursuitPayload extends Partial<CreatePursuitPayload> {
  completed_at?: string | null
}

export interface PursuitMember {
  id: string
  pursuit_id: string
  member_type: PursuitMemberType
  member_id: string
  added_at: string
}

// ============================================================
// People & Companies — canonical identity layer
// ============================================================

export interface Company {
  id: string
  user_id: string
  name: string
  aliases: string[]
  domain: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Person {
  id: string
  user_id: string
  name: string
  email: string | null
  aliases: string[]
  company_id: string | null
  role: string | null
  notes: string | null
  created_at: string
  updated_at: string
  // Joined
  companies?: Company | null
}

export interface MeetingAttendee {
  id: string
  meeting_id: string
  person_id: string
  added_at: string
  // Joined
  people?: Person | null
}

// ============================================================
// Item assists — persistent AI "Help me" responses per item
// ============================================================

// ============================================================
// Templates — reusable process maps for pursuits and goals
// ============================================================

export type TemplateType = 'pursuit' | 'goal'

export interface Template {
  id: string
  user_id: string
  name: string
  description: string | null
  template_type: TemplateType
  created_at: string
  updated_at: string
}

export interface TemplateStep {
  id: string
  template_id: string
  title: string
  description: string | null
  sort_order: number
  created_at: string
}

// ============================================================
// Goals — strategic objectives above pursuits
// ============================================================

export type GoalStatus = 'active' | 'completed' | 'archived'
export type GoalTaskStatus = 'pending' | 'in_progress' | 'done' | 'skipped'
export type MilestoneConditionType = 'manual' | 'pursuit' | 'item' | 'commitment' | 'meeting' | 'count'

export interface Goal {
  id: string
  user_id: string
  name: string
  description: string | null
  status: GoalStatus
  template_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface GoalTask {
  id: string
  goal_id: string
  title: string
  description: string | null
  sort_order: number
  status: GoalTaskStatus
  due_date: string | null
  created_at: string
  completed_at: string | null
  // Computed milestone fields
  condition_type: MilestoneConditionType
  linked_entity_id: string | null
  target_status: string | null
  condition_config: Record<string, unknown>
  condition_met: boolean
  last_evaluated_at: string | null
  evidence_text: string | null
}

export type ItemAssistType = 'approach' | 'context' | 'draft'

export interface ItemAssist {
  id: string
  user_id: string
  item_id: string
  assist_type: ItemAssistType
  content: string
  model: string
  generated_at: string
}

export interface Proposal {
  id: string
  user_id: string
  proposal_type: ProposalType
  source_type: ProposalSourceType
  source_id: string | null
  evidence_text: string | null
  normalized_payload: Record<string, unknown>
  accepted_payload: Record<string, unknown> | null
  confidence: number | null
  ambiguity_flags: string[]
  status: ProposalStatus
  review_action: ProposalReviewAction | null
  resulting_object_type: string | null
  resulting_object_id: string | null
  merge_target_id: string | null
  created_at: string
  reviewed_at: string | null
  updated_at: string
  // Client-side derived (set by useProposals via a join query, not a column)
  source_title?: string | null
}

export type IdeaStatus = 'surfaced' | 'exploring' | 'accepted' | 'dismissed' | 'archived'

export type IdeaCategory =
  | 'gtm_motion'
  | 'selling_approach'
  | 'partnership'
  | 'positioning'
  | 'campaign'
  | 'bundling'
  | 'product'
  | 'process'
  | 'other'

export type IdeaQuality = 'high' | 'medium' | 'low'

export interface Idea {
  id: string
  user_id: string
  title: string
  description: string | null
  evidence_text: string | null
  source_meeting_id: string | null
  originated_by: string | null
  company_id: string | null
  company_name: string | null
  context_notes: string | null
  category: IdeaCategory | null
  tags: string[] | null
  status: IdeaStatus
  promoted_to_goal_id: string | null
  promoted_to_pursuit_id: string | null
  cluster_id: string | null
  cluster_label: string | null
  quality: IdeaQuality | null
  triage_reason: string | null
  triaged_at: string | null
  created_at: string
  updated_at: string
  reviewed_at: string | null
}
