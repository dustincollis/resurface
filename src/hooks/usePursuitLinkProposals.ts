import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import type { PursuitLinkProposal } from '../lib/types'

// ----------------------------------------------------------------------------
// Queries
// ----------------------------------------------------------------------------

// Pending pursuit-link suggestions for the logged-in user. Used on /proposals
// to render a card at the top of the list.
export function usePendingPursuitLinkProposals() {
  const { user } = useAuth()

  useRealtimeSubscription({
    table: 'pursuit_link_proposals',
    queryKey: ['pursuit_link_proposals'],
  })

  return useQuery({
    queryKey: ['pursuit_link_proposals', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pursuit_link_proposals')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as PursuitLinkProposal[]
    },
    enabled: !!user,
  })
}

function invalidate() {
  queryClient.invalidateQueries({ queryKey: ['pursuit_link_proposals'] })
  queryClient.invalidateQueries({ queryKey: ['pursuit_members'] })
  queryClient.invalidateQueries({ queryKey: ['pursuits'] })
}

// ----------------------------------------------------------------------------
// Accept: insert pursuit_members row (meeting), mark proposal accepted.
// ----------------------------------------------------------------------------

export function useAcceptPursuitLinkProposal() {
  return useMutation({
    mutationFn: async (proposal: PursuitLinkProposal) => {
      // Insert the membership. Unique constraint on (pursuit_id, member_type,
      // member_id) means a duplicate insert is harmless — we swallow that case.
      const { error: memberErr } = await supabase.from('pursuit_members').insert({
        pursuit_id: proposal.suggested_pursuit_id,
        member_type: 'meeting',
        member_id: proposal.source_meeting_id,
      })
      if (memberErr && memberErr.code !== '23505') throw memberErr

      const { error: updErr } = await supabase
        .from('pursuit_link_proposals')
        .update({
          status: 'accepted',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', proposal.id)
      if (updErr) throw updErr
    },
    onSuccess: invalidate,
  })
}

// ----------------------------------------------------------------------------
// Reject: just mark the proposal rejected. Meeting stays unlinked.
// ----------------------------------------------------------------------------

export function useRejectPursuitLinkProposal() {
  return useMutation({
    mutationFn: async (proposalId: string) => {
      const { error } = await supabase
        .from('pursuit_link_proposals')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', proposalId)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}
