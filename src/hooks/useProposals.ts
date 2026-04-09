import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import type {
  Proposal,
  ProposalStatus,
  ProposalReviewAction,
  TaskProposalPayload,
  CommitmentProposalPayload,
  Item,
  Commitment,
  CreateItemPayload,
  CreateCommitmentPayload,
} from '../lib/types'

interface ProposalFilters {
  status?: ProposalStatus | ProposalStatus[]
  source_type?: string
  source_id?: string
}

export function useProposals(filters?: ProposalFilters) {
  const { user } = useAuth()

  useRealtimeSubscription({
    table: 'proposals',
    queryKey: ['proposals'],
  })

  return useQuery({
    queryKey: ['proposals', filters],
    queryFn: async () => {
      let query = supabase.from('proposals').select('*')

      if (filters?.status) {
        if (Array.isArray(filters.status)) {
          query = query.in('status', filters.status)
        } else {
          query = query.eq('status', filters.status)
        }
      } else {
        // default: pending only
        query = query.eq('status', 'pending')
      }

      if (filters?.source_type) {
        query = query.eq('source_type', filters.source_type)
      }
      if (filters?.source_id) {
        query = query.eq('source_id', filters.source_id)
      }

      const { data, error } = await query.order('created_at', { ascending: false })
      if (error) throw error
      const proposals = data as Proposal[]

      // Enrich with source meeting titles. source_id is polymorphic
      // (varies by source_type), so we can't use a PostgREST join.
      // One extra query covers all meeting-sourced proposals at once.
      const meetingIds = Array.from(
        new Set(
          proposals
            .filter((p) => p.source_type === 'meeting' && p.source_id)
            .map((p) => p.source_id as string)
        )
      )
      if (meetingIds.length > 0) {
        const { data: meetingRows } = await supabase
          .from('meetings')
          .select('id, title')
          .in('id', meetingIds)
        const titleById = new Map(
          (meetingRows ?? []).map((m) => [m.id as string, m.title as string])
        )
        for (const p of proposals) {
          if (p.source_type === 'meeting' && p.source_id) {
            p.source_title = titleById.get(p.source_id) ?? null
          }
        }
      }

      return proposals
    },
    enabled: !!user,
  })
}

// Used by MeetingDetail to show "N proposals from this meeting" without
// rendering the full triage UX inline.
export function useProposalsBySource(sourceType: string, sourceId: string) {
  return useProposals({ source_type: sourceType, source_id: sourceId, status: ['pending', 'accepted', 'merged'] })
}

function invalidateProposals() {
  queryClient.invalidateQueries({ queryKey: ['proposals'] })
}

// ============================================================
// Acceptance — user picks the target type at acceptance time.
//
// `acceptAs` lets the user override the parser's suggested proposal_type.
// A task proposal can be accepted as a commitment (outgoing or incoming),
// and vice versa. The proposal's payload is mapped to the target type's
// shape. If the user explicitly edited fields, those win over the
// auto-mapping.
//
// `pursuitId` optionally adds the resulting object to a pursuit in the
// same action, so users don't have to navigate to the new object's
// detail page just to add it to a thread of work.
// ============================================================

export type AcceptAs = 'task' | 'commitment_outgoing' | 'commitment_incoming'

interface AcceptProposalArgs {
  proposal: Proposal
  acceptAs: AcceptAs
  editedPayload?: Record<string, unknown>
  pursuitId?: string | null
}

export function useAcceptProposal() {
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({
      proposal,
      acceptAs,
      editedPayload,
      pursuitId,
    }: AcceptProposalArgs) => {
      // The parser's payload may be either task-shaped (title, due_date,
      // assignee, ...) or commitment-shaped (title, counterpart, do_by, ...).
      // We normalize to the target type below.
      const sourcePayload = (editedPayload ?? proposal.normalized_payload) as Record<string, unknown>
      const isSourceTask = proposal.proposal_type === 'task'

      let resultingObjectType: string | null = null
      let resultingObjectId: string | null = null

      if (acceptAs === 'task') {
        // Map source → task shape
        const taskFields = isSourceTask
          ? (sourcePayload as unknown as TaskProposalPayload)
          : ({
              title: (sourcePayload.title as string) ?? '',
              description: (sourcePayload.description as string) ?? '',
              due_date: (sourcePayload.do_by as string | null) ?? null,
              company: (sourcePayload.company as string | null) ?? null,
              source_meeting_id: (sourcePayload.source_meeting_id as string | null) ?? null,
            } as TaskProposalPayload)

        const insertPayload: CreateItemPayload & { user_id: string } = {
          user_id: user!.id,
          title: taskFields.title,
          description: taskFields.description ?? '',
          next_action: taskFields.next_action ?? undefined,
          due_date: taskFields.due_date ?? null,
          stream_id: taskFields.stream_id ?? null,
          source_meeting_id: taskFields.source_meeting_id ?? null,
          custom_fields: taskFields.company ? { company: taskFields.company } : undefined,
        }
        const { data: itemRow, error: insertErr } = await supabase
          .from('items')
          .insert(insertPayload)
          .select()
          .single()
        if (insertErr) throw insertErr
        const item = itemRow as Item
        resultingObjectType = 'item'
        resultingObjectId = item.id

        // Mirror useCreateItem: log activity + fire-and-forget classify
        supabase.from('activity_log').insert({
          user_id: item.user_id,
          item_id: item.id,
          action: 'created',
          details: { title: item.title, source: 'proposal', proposal_id: proposal.id },
        })
      } else {
        // commitment_outgoing or commitment_incoming
        const direction = acceptAs === 'commitment_outgoing' ? 'outgoing' : 'incoming'

        // Map source → commitment shape
        const commitmentFields = isSourceTask
          ? ({
              title: (sourcePayload.title as string) ?? '',
              description: (sourcePayload.description as string) ?? '',
              do_by: (sourcePayload.due_date as string | null) ?? null,
              company: (sourcePayload.company as string | null) ?? null,
              source_meeting_id: (sourcePayload.source_meeting_id as string | null) ?? null,
              // For incoming commitments, the assignee on the task IS the
              // counterpart (the person who owes the user). For outgoing,
              // we leave it blank — the user defines who they owe.
              counterpart:
                direction === 'incoming' &&
                typeof sourcePayload.assignee === 'string' &&
                sourcePayload.assignee !== 'user' &&
                sourcePayload.assignee !== 'unknown'
                  ? (sourcePayload.assignee as string)
                  : null,
            } as CommitmentProposalPayload)
          : (sourcePayload as unknown as CommitmentProposalPayload)

        const insertPayload: CreateCommitmentPayload & { user_id: string } = {
          user_id: user!.id,
          title: commitmentFields.title,
          description: commitmentFields.description ?? null,
          counterpart: commitmentFields.counterpart ?? null,
          company: commitmentFields.company ?? null,
          do_by: commitmentFields.do_by ?? null,
          promised_by: commitmentFields.promised_by ?? null,
          needs_review_by: commitmentFields.needs_review_by ?? null,
          source_meeting_id: commitmentFields.source_meeting_id ?? null,
          source_item_id: commitmentFields.source_item_id ?? null,
          evidence_text: proposal.evidence_text ?? null,
          confidence: proposal.confidence ?? null,
          status: 'open',
          direction,
        }
        const { data: commitmentRow, error: insertErr } = await supabase
          .from('commitments')
          .insert(insertPayload)
          .select()
          .single()
        if (insertErr) throw insertErr
        const commitment = commitmentRow as Commitment
        resultingObjectType = 'commitment'
        resultingObjectId = commitment.id
      }

      // If the user picked a pursuit, attach the new object to it.
      if (pursuitId && resultingObjectId && resultingObjectType) {
        const memberType = resultingObjectType === 'item' ? 'item' : 'commitment'
        await supabase.from('pursuit_members').insert({
          pursuit_id: pursuitId,
          member_type: memberType,
          member_id: resultingObjectId,
        })
      }

      const { error: updateErr } = await supabase
        .from('proposals')
        .update({
          status: 'accepted',
          review_action: editedPayload ? 'edit' : 'accept',
          accepted_payload: sourcePayload,
          resulting_object_type: resultingObjectType,
          resulting_object_id: resultingObjectId,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', proposal.id)
      if (updateErr) throw updateErr

      return { resultingObjectType, resultingObjectId }
    },
    onSuccess: () => {
      invalidateProposals()
      queryClient.invalidateQueries({ queryKey: ['items'] })
      queryClient.invalidateQueries({ queryKey: ['commitments'] })
      queryClient.invalidateQueries({ queryKey: ['pursuit_members'] })
    },
  })
}

// Helper: derive the default acceptAs choice from a proposal's parser-
// suggested type. Used to seed the type selector in the UI.
export function defaultAcceptAs(proposal: Proposal): AcceptAs {
  return proposal.proposal_type === 'commitment' ? 'commitment_outgoing' : 'task'
}

// ============================================================
// Rejection / dismissal — record the user's labeled judgment
// ============================================================

interface RejectArgs {
  proposalId: string
  action: Extract<ProposalReviewAction, 'not_actionable' | 'dismiss_banter'>
}

export function useRejectProposal() {
  return useMutation({
    mutationFn: async ({ proposalId, action }: RejectArgs) => {
      const status: ProposalStatus = action === 'dismiss_banter' ? 'dismissed' : 'rejected'
      const { error } = await supabase
        .from('proposals')
        .update({
          status,
          review_action: action,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', proposalId)
      if (error) throw error
    },
    onSuccess: invalidateProposals,
  })
}

// Deprecated: superseded by useAcceptProposal with acceptAs='commitment_incoming'.
// The ProposalCard's old "Track as commitment" button has been replaced by
// the type chip group, so this hook is no longer used in the UI. Kept as
// a no-op alias in case any other caller still imports it.

// ============================================================
// Merge into existing item (task proposals only for chunk 0)
// ============================================================

export function useMergeProposal() {
  return useMutation({
    mutationFn: async ({
      proposal,
      targetItemId,
    }: {
      proposal: Proposal
      targetItemId: string
    }) => {
      if (proposal.proposal_type !== 'task') {
        throw new Error(
          `Merge for proposal_type='${proposal.proposal_type}' is not yet implemented.`
        )
      }

      // Touch the target item so it surfaces and reflects new evidence.
      // Chunk 2 will add reconciliation logic that actually folds the
      // proposal payload into the existing item; for now we record the
      // merge intent and bump last_touched_at.
      const { error: touchErr } = await supabase
        .from('items')
        .update({ last_touched_at: new Date().toISOString() })
        .eq('id', targetItemId)
      if (touchErr) throw touchErr

      const { error: updateErr } = await supabase
        .from('proposals')
        .update({
          status: 'merged',
          review_action: 'merge',
          merge_target_id: targetItemId,
          resulting_object_type: 'item',
          resulting_object_id: targetItemId,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', proposal.id)
      if (updateErr) throw updateErr
    },
    onSuccess: () => {
      invalidateProposals()
      queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
}
