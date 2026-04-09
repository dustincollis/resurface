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
// Commitments — outgoing soft obligations
// ============================================================

export type CommitmentStatus = 'open' | 'met' | 'broken' | 'cancelled' | 'waiting'

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
  source_meeting_id?: string | null
  source_item_id?: string | null
  evidence_text?: string | null
  confidence?: number | null
}

export interface UpdateCommitmentPayload extends Partial<CreateCommitmentPayload> {
  completed_at?: string | null
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
