import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import type { Idea, IdeaStatus, IdeaCategory } from '../lib/types'

interface IdeaFilters {
  status?: IdeaStatus | IdeaStatus[]
  category?: IdeaCategory
  company_id?: string
  cluster_id?: string
  source_meeting_id?: string
}

export function useIdeas(filters?: IdeaFilters) {
  const { user } = useAuth()

  useRealtimeSubscription({ table: 'ideas', queryKey: ['ideas'] })

  return useQuery({
    queryKey: ['ideas', filters],
    queryFn: async () => {
      let query = supabase.from('ideas').select('*')
      if (filters?.status) {
        if (Array.isArray(filters.status)) {
          query = query.in('status', filters.status)
        } else {
          query = query.eq('status', filters.status)
        }
      }
      if (filters?.category) {
        query = query.eq('category', filters.category)
      }
      if (filters?.company_id) {
        query = query.eq('company_id', filters.company_id)
      }
      if (filters?.cluster_id) {
        query = query.eq('cluster_id', filters.cluster_id)
      }
      if (filters?.source_meeting_id) {
        query = query.eq('source_meeting_id', filters.source_meeting_id)
      }
      const { data, error } = await query.order('created_at', { ascending: false })
      if (error) throw error
      return data as Idea[]
    },
    enabled: !!user,
  })
}

export function useIdea(id: string) {
  return useQuery({
    queryKey: ['ideas', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ideas')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data as Idea
    },
    enabled: !!id,
  })
}

export function useIdeasByMeeting(meetingId: string) {
  return useQuery({
    queryKey: ['ideas', 'meeting', meetingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ideas')
        .select('*')
        .eq('source_meeting_id', meetingId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as Idea[]
    },
    enabled: !!meetingId,
  })
}

export function useIdeasByGoal(goalId: string) {
  return useQuery({
    queryKey: ['ideas', 'goal', goalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ideas')
        .select('*')
        .eq('promoted_to_goal_id', goalId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Idea[]
    },
    enabled: !!goalId,
  })
}

export function useIdeasByPursuit(pursuitId: string) {
  return useQuery({
    queryKey: ['ideas', 'pursuit', pursuitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ideas')
        .select('*')
        .eq('promoted_to_pursuit_id', pursuitId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Idea[]
    },
    enabled: !!pursuitId,
  })
}

export function useIdeaCounts() {
  const { user } = useAuth()

  useRealtimeSubscription({ table: 'ideas', queryKey: ['ideas'] })

  return useQuery({
    queryKey: ['ideas', 'counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ideas')
        .select('status')
      if (error) throw error
      const counts: Record<string, number> = {
        surfaced: 0,
        exploring: 0,
        accepted: 0,
        dismissed: 0,
        archived: 0,
      }
      for (const row of data) {
        counts[row.status] = (counts[row.status] || 0) + 1
      }
      return counts
    },
    enabled: !!user,
  })
}

function invalidateIdeas() {
  queryClient.invalidateQueries({ queryKey: ['ideas'] })
}

export function useUpdateIdeaStatus() {
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: IdeaStatus }) => {
      const updates: Record<string, unknown> = { status }
      if (status !== 'surfaced' && status !== 'dismissed') {
        updates.reviewed_at = new Date().toISOString()
      }
      const { data, error } = await supabase
        .from('ideas')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Idea
    },
    onSuccess: invalidateIdeas,
  })
}

export function useUpdateIdea() {
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Idea> & { id: string }) => {
      const { data, error } = await supabase
        .from('ideas')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Idea
    },
    onSuccess: invalidateIdeas,
  })
}

export function usePromoteIdeaToGoal() {
  return useMutation({
    mutationFn: async ({ ideaId, goalId }: { ideaId: string; goalId?: string; name?: string; description?: string }) => {
      // Link to existing goal
      if (goalId) {
        const { error } = await supabase
          .from('ideas')
          .update({
            promoted_to_goal_id: goalId,
            status: 'accepted' as IdeaStatus,
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', ideaId)
        if (error) throw error
        return { ideaId, goalId }
      }
      throw new Error('goalId required')
    },
    onSuccess: () => {
      invalidateIdeas()
      queryClient.invalidateQueries({ queryKey: ['goals'] })
    },
  })
}

export function useRunClustering() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('ai-cluster-ideas', {
        body: {},
      })
      if (error) throw error
      return data as {
        total_ideas: number
        clusters_found: number
        ideas_clustered: number
        ideas_unclustered: number
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ideas'] })
    },
  })
}

export function usePromoteIdeaToPursuit() {
  return useMutation({
    mutationFn: async ({ ideaId, pursuitId }: { ideaId: string; pursuitId?: string }) => {
      if (pursuitId) {
        const { error } = await supabase
          .from('ideas')
          .update({
            promoted_to_pursuit_id: pursuitId,
            status: 'accepted' as IdeaStatus,
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', ideaId)
        if (error) throw error
        return { ideaId, pursuitId }
      }
      throw new Error('pursuitId required')
    },
    onSuccess: () => {
      invalidateIdeas()
      queryClient.invalidateQueries({ queryKey: ['pursuits'] })
    },
  })
}
