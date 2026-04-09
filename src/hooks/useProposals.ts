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
  Item,
  CreateItemPayload,
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
// Acceptance — polymorphic by proposal_type.
// Chunk 0: only `task` is wired. Other types throw.
// ============================================================

export function useAcceptProposal() {
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({
      proposal,
      editedPayload,
    }: {
      proposal: Proposal
      editedPayload?: Record<string, unknown>
    }) => {
      const finalPayload = (editedPayload ?? proposal.normalized_payload) as Record<string, unknown>

      let resultingObjectType: string | null = null
      let resultingObjectId: string | null = null

      if (proposal.proposal_type === 'task') {
        const p = finalPayload as unknown as TaskProposalPayload
        const insertPayload: CreateItemPayload & { user_id: string } = {
          user_id: user!.id,
          title: p.title,
          description: p.description ?? '',
          next_action: p.next_action ?? undefined,
          due_date: p.due_date ?? null,
          stream_id: p.stream_id ?? null,
          source_meeting_id: p.source_meeting_id ?? null,
          custom_fields: p.company ? { company: p.company } : undefined,
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
        throw new Error(
          `Acceptance for proposal_type='${proposal.proposal_type}' is not yet implemented. ` +
            `It will land in a later chunk.`
        )
      }

      const { error: updateErr } = await supabase
        .from('proposals')
        .update({
          status: 'accepted',
          review_action: editedPayload ? 'edit' : 'accept',
          accepted_payload: finalPayload,
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
    },
  })
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
