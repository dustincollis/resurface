import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import type {
  Pursuit,
  PursuitStatus,
  PursuitMember,
  PursuitMemberType,
  CreatePursuitPayload,
  UpdatePursuitPayload,
  PlaybookStep,
  PlaybookEvidenceType,
} from '../lib/types'

interface PursuitFilters {
  status?: PursuitStatus | PursuitStatus[]
}

export function usePursuits(filters?: PursuitFilters) {
  const { user } = useAuth()

  useRealtimeSubscription({ table: 'pursuits', queryKey: ['pursuits'] })

  return useQuery({
    queryKey: ['pursuits', filters],
    queryFn: async () => {
      let query = supabase.from('pursuits').select('*')
      if (filters?.status) {
        if (Array.isArray(filters.status)) {
          query = query.in('status', filters.status)
        } else {
          query = query.eq('status', filters.status)
        }
      }
      const { data, error } = await query
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
      if (error) throw error
      return data as Pursuit[]
    },
    enabled: !!user,
  })
}

export function usePursuit(id: string) {
  return useQuery({
    queryKey: ['pursuits', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pursuits')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data as Pursuit
    },
    enabled: !!id,
  })
}

function invalidatePursuits() {
  queryClient.invalidateQueries({ queryKey: ['pursuits'] })
  queryClient.invalidateQueries({ queryKey: ['pursuit_members'] })
}

export function useCreatePursuit() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (payload: CreatePursuitPayload) => {
      const { data, error } = await supabase
        .from('pursuits')
        .insert({ ...payload, user_id: user!.id })
        .select()
        .single()
      if (error) throw error
      return data as Pursuit
    },
    onSuccess: invalidatePursuits,
  })
}

export function useUpdatePursuit() {
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: UpdatePursuitPayload & { id: string }) => {
      const { data, error } = await supabase
        .from('pursuits')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Pursuit
    },
    onSuccess: invalidatePursuits,
  })
}

export function useDeletePursuit() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('pursuits').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidatePursuits,
  })
}

export function useSetPursuitStatus() {
  const update = useUpdatePursuit()
  return (id: string, status: PursuitStatus) =>
    update.mutateAsync({
      id,
      status,
      completed_at:
        status === 'active' ? null : new Date().toISOString(),
    })
}

// ============================================================
// Members — polymorphic join table for items / commitments / meetings
// ============================================================

export function usePursuitMembers(pursuitId: string) {
  useRealtimeSubscription({
    table: 'pursuit_members',
    queryKey: ['pursuit_members', pursuitId],
  })

  return useQuery({
    queryKey: ['pursuit_members', pursuitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pursuit_members')
        .select('*')
        .eq('pursuit_id', pursuitId)
        .order('added_at', { ascending: false })
      if (error) throw error
      return data as PursuitMember[]
    },
    enabled: !!pursuitId,
  })
}

// Pursuits a given member belongs to. Used by item / commitment / meeting
// detail pages to show "this is in N pursuits" badges.
export function usePursuitsForMember(memberType: PursuitMemberType, memberId: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['pursuit_members', 'for', memberType, memberId],
    queryFn: async () => {
      // First get the pursuit_member rows for this member
      const { data: memberRows, error: memberErr } = await supabase
        .from('pursuit_members')
        .select('pursuit_id')
        .eq('member_type', memberType)
        .eq('member_id', memberId)
      if (memberErr) throw memberErr
      const pursuitIds = (memberRows ?? []).map((r) => r.pursuit_id as string)
      if (pursuitIds.length === 0) return [] as Pursuit[]
      const { data: pursuitRows, error: pErr } = await supabase
        .from('pursuits')
        .select('*')
        .in('id', pursuitIds)
      if (pErr) throw pErr
      return pursuitRows as Pursuit[]
    },
    enabled: !!user && !!memberId,
  })
}

export function useAddPursuitMember() {
  return useMutation({
    mutationFn: async ({
      pursuitId,
      memberType,
      memberId,
    }: {
      pursuitId: string
      memberType: PursuitMemberType
      memberId: string
    }) => {
      const { data, error } = await supabase
        .from('pursuit_members')
        .insert({
          pursuit_id: pursuitId,
          member_type: memberType,
          member_id: memberId,
        })
        .select()
        .single()
      if (error) throw error
      return data as PursuitMember
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['pursuit_members', vars.pursuitId] })
      queryClient.invalidateQueries({
        queryKey: ['pursuit_members', 'for', vars.memberType, vars.memberId],
      })
    },
  })
}

export function useRemovePursuitMember() {
  return useMutation({
    mutationFn: async ({
      pursuitId,
      memberType,
      memberId,
    }: {
      pursuitId: string
      memberType: PursuitMemberType
      memberId: string
    }) => {
      const { error } = await supabase
        .from('pursuit_members')
        .delete()
        .eq('pursuit_id', pursuitId)
        .eq('member_type', memberType)
        .eq('member_id', memberId)
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['pursuit_members', vars.pursuitId] })
      queryClient.invalidateQueries({
        queryKey: ['pursuit_members', 'for', vars.memberType, vars.memberId],
      })
    },
  })
}

// ============================================================
// Playbook steps — evidence-based template tracking
// ============================================================

export function usePlaybookSteps(pursuitId: string) {
  useRealtimeSubscription({
    table: 'pursuit_playbook_steps',
    queryKey: ['playbook_steps', pursuitId],
  })

  return useQuery({
    queryKey: ['playbook_steps', pursuitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pursuit_playbook_steps')
        .select('*')
        .eq('pursuit_id', pursuitId)
        .order('sort_order')
      if (error) throw error
      return data as PlaybookStep[]
    },
    enabled: !!pursuitId,
  })
}

export function useMarkPlaybookStep() {
  return useMutation({
    mutationFn: async ({
      stepId,
      evidenced,
      evidence_type,
      evidence_entity_id,
      evidence_note,
    }: {
      stepId: string
      evidenced: boolean
      evidence_type?: PlaybookEvidenceType | null
      evidence_entity_id?: string | null
      evidence_note?: string | null
    }) => {
      const { error } = await supabase
        .from('pursuit_playbook_steps')
        .update({
          evidenced,
          evidenced_at: evidenced ? new Date().toISOString() : null,
          evidence_type: evidenced ? (evidence_type ?? 'manual') : null,
          evidence_entity_id: evidenced ? (evidence_entity_id ?? null) : null,
          evidence_note: evidenced ? (evidence_note ?? null) : null,
        })
        .eq('id', stepId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playbook_steps'] })
    },
  })
}
