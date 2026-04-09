import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import type {
  Commitment,
  CommitmentStatus,
  CreateCommitmentPayload,
  UpdateCommitmentPayload,
} from '../lib/types'

interface CommitmentFilters {
  status?: CommitmentStatus | CommitmentStatus[]
  source_meeting_id?: string
  source_item_id?: string
}

export function useCommitments(filters?: CommitmentFilters) {
  const { user } = useAuth()

  useRealtimeSubscription({
    table: 'commitments',
    queryKey: ['commitments'],
  })

  return useQuery({
    queryKey: ['commitments', filters],
    queryFn: async () => {
      let query = supabase.from('commitments').select('*')

      if (filters?.status) {
        if (Array.isArray(filters.status)) {
          query = query.in('status', filters.status)
        } else {
          query = query.eq('status', filters.status)
        }
      }
      if (filters?.source_meeting_id) {
        query = query.eq('source_meeting_id', filters.source_meeting_id)
      }
      if (filters?.source_item_id) {
        query = query.eq('source_item_id', filters.source_item_id)
      }

      const { data, error } = await query
        .order('do_by', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Commitment[]
    },
    enabled: !!user,
  })
}

export function useCommitmentsByMeeting(meetingId: string) {
  return useCommitments({ source_meeting_id: meetingId })
}

export function useCommitmentsByItem(itemId: string) {
  return useCommitments({ source_item_id: itemId })
}

function invalidateCommitments() {
  queryClient.invalidateQueries({ queryKey: ['commitments'] })
}

export function useCreateCommitment() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (payload: CreateCommitmentPayload) => {
      const { data, error } = await supabase
        .from('commitments')
        .insert({ ...payload, user_id: user!.id })
        .select()
        .single()
      if (error) throw error
      return data as Commitment
    },
    onSuccess: invalidateCommitments,
  })
}

export function useUpdateCommitment() {
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: UpdateCommitmentPayload & { id: string }) => {
      const { data, error } = await supabase
        .from('commitments')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Commitment
    },
    onSuccess: invalidateCommitments,
  })
}

export function useDeleteCommitment() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('commitments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidateCommitments,
  })
}

// Convenience: change status with the right side effects (completed_at on met).
export function useSetCommitmentStatus() {
  const update = useUpdateCommitment()
  return (id: string, status: CommitmentStatus) =>
    update.mutateAsync({
      id,
      status,
      completed_at: status === 'met' ? new Date().toISOString() : null,
    })
}
