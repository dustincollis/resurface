import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import type {
  ProposalGroup,
  Proposal,
  Item,
  TaskProposalPayload,
  CreateItemPayload,
} from '../lib/types'

// ----------------------------------------------------------------------------
// Queries
// ----------------------------------------------------------------------------

// Pending groups for a specific meeting. Used by the /proposals page when
// filtered to a single meeting source. Cross-meeting display is intentionally
// out of scope for v1.
export function usePendingProposalGroupsByMeeting(meetingId: string | null) {
  const { user } = useAuth()

  useRealtimeSubscription({
    table: 'proposal_groups',
    queryKey: ['proposal_groups'],
  })

  return useQuery({
    queryKey: ['proposal_groups', 'meeting', meetingId],
    queryFn: async () => {
      if (!meetingId) return []
      const { data, error } = await supabase
        .from('proposal_groups')
        .select('*')
        .eq('source_meeting_id', meetingId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as ProposalGroup[]
    },
    enabled: !!user && !!meetingId,
  })
}

function invalidate() {
  queryClient.invalidateQueries({ queryKey: ['proposal_groups'] })
  queryClient.invalidateQueries({ queryKey: ['proposals'] })
  queryClient.invalidateQueries({ queryKey: ['items'] })
}

// ----------------------------------------------------------------------------
// Accept group: create parent item, then accept every member proposal as a
// task with parent_id set to the new parent. Mirrors useAcceptProposal's task
// branch but in batch.
// ----------------------------------------------------------------------------

interface AcceptGroupArgs {
  group: ProposalGroup
  // Editable title -- defaults to group.suggested_title in the UI.
  title: string
}

export function useAcceptProposalGroup() {
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({ group, title }: AcceptGroupArgs) => {
      if (!user) throw new Error('not authenticated')
      if (group.proposal_ids.length < 2) {
        throw new Error('group needs at least 2 members')
      }

      // Load the member proposals so we can derive the parent's stream and
      // pass the right normalized payloads when creating each child item.
      const { data: proposalsData, error: loadErr } = await supabase
        .from('proposals')
        .select('*')
        .in('id', group.proposal_ids)
        .eq('status', 'pending')
      if (loadErr) throw loadErr
      const members = (proposalsData ?? []) as Proposal[]
      if (members.length === 0) {
        throw new Error('no pending proposals found in group')
      }

      // Stream inheritance: parent inherits stream only if every member shares
      // the same one. Otherwise stream stays null on the parent.
      const memberStreams = members
        .map((p) => (p.normalized_payload as unknown as TaskProposalPayload).stream_id ?? null)
        .filter((s): s is string => typeof s === 'string')
      const streamId =
        memberStreams.length === members.length &&
        memberStreams.every((s) => s === memberStreams[0])
          ? memberStreams[0]
          : null

      // 1. Create parent item.
      const { data: parentRow, error: parentErr } = await supabase
        .from('items')
        .insert({
          user_id: user.id,
          title,
          description: '',
          status: 'open',
          stream_id: streamId,
          source_meeting_id: group.source_meeting_id,
        })
        .select()
        .single()
      if (parentErr) throw parentErr
      const parent = parentRow as Item

      // 2. For each member, create a child item and update the proposal to
      // accepted. Done sequentially to keep error handling simple; the volume
      // is small (typically 3-8 proposals).
      const createdChildIds: string[] = []
      for (const proposal of members) {
        const payload = proposal.normalized_payload as unknown as (TaskProposalPayload & {
          company?: string | null
        })
        const insertPayload: CreateItemPayload & { user_id: string } = {
          user_id: user.id,
          title: payload.title ?? '',
          description: payload.description ?? '',
          next_action: payload.next_action ?? undefined,
          due_date: payload.due_date ?? null,
          stream_id: payload.stream_id ?? streamId,
          parent_id: parent.id,
          source_meeting_id: payload.source_meeting_id ?? group.source_meeting_id,
          custom_fields: payload.company ? { company: payload.company } : undefined,
        }
        const { data: childRow, error: childErr } = await supabase
          .from('items')
          .insert(insertPayload)
          .select()
          .single()
        if (childErr) throw childErr
        const child = childRow as Item
        createdChildIds.push(child.id)

        // Mark proposal accepted, mirroring useAcceptProposal.
        const { error: updErr } = await supabase
          .from('proposals')
          .update({
            status: 'accepted',
            review_action: 'accept',
            accepted_payload: payload,
            resulting_object_type: 'item',
            resulting_object_id: child.id,
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', proposal.id)
        if (updErr) throw updErr

        // Activity log -- fire and forget.
        supabase.from('activity_log').insert({
          user_id: user.id,
          item_id: child.id,
          action: 'created',
          details: {
            title: child.title,
            source: 'proposal_group',
            proposal_id: proposal.id,
            group_id: group.id,
          },
        })
      }

      // 3. Mark the group accepted.
      const { error: groupErr } = await supabase
        .from('proposal_groups')
        .update({
          status: 'accepted',
          resulting_parent_item_id: parent.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', group.id)
      if (groupErr) throw groupErr

      return { parentId: parent.id, childIds: createdChildIds }
    },
    onSuccess: invalidate,
  })
}

// ----------------------------------------------------------------------------
// Reject group: member proposals stay pending in normal triage.
// ----------------------------------------------------------------------------

export function useRejectProposalGroup() {
  return useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase
        .from('proposal_groups')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', groupId)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

// ----------------------------------------------------------------------------
// Remove a single proposal from the group (the ✕ button on a member row).
// If the group falls below 2 members it auto-rejects -- a 1-item group is
// no longer a cluster.
// ----------------------------------------------------------------------------

export function useRemoveFromProposalGroup() {
  return useMutation({
    mutationFn: async ({
      group,
      proposalId,
    }: {
      group: ProposalGroup
      proposalId: string
    }) => {
      const remaining = group.proposal_ids.filter((id) => id !== proposalId)
      if (remaining.length < 2) {
        const { error } = await supabase
          .from('proposal_groups')
          .update({
            status: 'rejected',
            proposal_ids: remaining,
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', group.id)
        if (error) throw error
        return { autoRejected: true }
      }
      const { error } = await supabase
        .from('proposal_groups')
        .update({ proposal_ids: remaining })
        .eq('id', group.id)
      if (error) throw error
      return { autoRejected: false }
    },
    onSuccess: invalidate,
  })
}
