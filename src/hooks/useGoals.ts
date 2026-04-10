import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import type { Goal, GoalStatus, GoalTask, GoalTaskStatus, MilestoneConditionType } from '../lib/types'

export function useGoals(status?: GoalStatus | GoalStatus[]) {
  const { user } = useAuth()

  useRealtimeSubscription({ table: 'goals', queryKey: ['goals'] })

  return useQuery({
    queryKey: ['goals', status],
    queryFn: async () => {
      let query = supabase.from('goals').select('*')
      if (status) {
        if (Array.isArray(status)) {
          query = query.in('status', status)
        } else {
          query = query.eq('status', status)
        }
      }
      const { data, error } = await query.order('created_at', { ascending: false })
      if (error) throw error
      return data as Goal[]
    },
    enabled: !!user,
  })
}

export function useGoal(id: string) {
  return useQuery({
    queryKey: ['goals', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('goals')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data as Goal
    },
    enabled: !!id,
  })
}

export function useGoalTasks(goalId: string) {
  useRealtimeSubscription({
    table: 'goal_tasks',
    queryKey: ['goal_tasks', goalId],
  })

  return useQuery({
    queryKey: ['goal_tasks', goalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('goal_tasks')
        .select('*')
        .eq('goal_id', goalId)
        .order('sort_order')
      if (error) throw error
      return data as GoalTask[]
    },
    enabled: !!goalId,
  })
}

function invalidateGoals() {
  queryClient.invalidateQueries({ queryKey: ['goals'] })
  queryClient.invalidateQueries({ queryKey: ['goal_tasks'] })
}

export function useCreateGoal() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (payload: {
      name: string
      description?: string | null
      template_id?: string | null
    }) => {
      const { data, error } = await supabase
        .from('goals')
        .insert({ ...payload, user_id: user!.id })
        .select()
        .single()
      if (error) throw error
      return data as Goal
    },
    onSuccess: invalidateGoals,
  })
}

export function useUpdateGoal() {
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string
      name?: string
      description?: string | null
      status?: GoalStatus
      completed_at?: string | null
    }) => {
      const { data, error } = await supabase
        .from('goals')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Goal
    },
    onSuccess: invalidateGoals,
  })
}

export function useDeleteGoal() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('goals').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidateGoals,
  })
}

export function useSetGoalStatus() {
  const update = useUpdateGoal()
  return (id: string, status: GoalStatus) =>
    update.mutateAsync({
      id,
      status,
      completed_at: status === 'active' ? null : new Date().toISOString(),
    })
}

// Goal tasks
export function useCreateGoalTask() {
  return useMutation({
    mutationFn: async (payload: {
      goal_id: string
      title: string
      description?: string | null
      sort_order?: number
      due_date?: string | null
      condition_type?: MilestoneConditionType
      linked_entity_id?: string | null
      target_status?: string | null
      condition_config?: Record<string, unknown>
    }) => {
      const { data, error } = await supabase
        .from('goal_tasks')
        .insert(payload)
        .select()
        .single()
      if (error) throw error
      return data as GoalTask
    },
    onSuccess: invalidateGoals,
  })
}

export function useUpdateGoalTask() {
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string
      title?: string
      description?: string | null
      status?: GoalTaskStatus
      sort_order?: number
      due_date?: string | null
      completed_at?: string | null
    }) => {
      const { error } = await supabase
        .from('goal_tasks')
        .update(updates)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidateGoals,
  })
}

export function useDeleteGoalTask() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('goal_tasks').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidateGoals,
  })
}

export function useSetGoalTaskStatus() {
  const update = useUpdateGoalTask()
  return (id: string, status: GoalTaskStatus) =>
    update.mutateAsync({
      id,
      status,
      completed_at: status === 'done' ? new Date().toISOString() : null,
    })
}

// Evaluate computed milestones for a goal
export function useEvaluateGoal() {
  return useMutation({
    mutationFn: async (goalId: string) => {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/evaluate-goals`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ goal_id: goalId }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Evaluation failed')
      return json
    },
    onSuccess: invalidateGoals,
  })
}

// Apply a template to a goal: reads template steps, creates goal_tasks
export function useApplyTemplateToGoal() {
  return useMutation({
    mutationFn: async ({
      goalId,
      templateId,
    }: {
      goalId: string
      templateId: string
    }) => {
      const { data: steps, error: stepsErr } = await supabase
        .from('template_steps')
        .select('*')
        .eq('template_id', templateId)
        .order('sort_order')
      if (stepsErr) throw stepsErr

      const tasks = (steps ?? []).map((s, i) => ({
        goal_id: goalId,
        title: s.title,
        description: s.description,
        sort_order: i,
      }))

      if (tasks.length > 0) {
        const { error: insertErr } = await supabase
          .from('goal_tasks')
          .insert(tasks)
        if (insertErr) throw insertErr
      }

      // Mark the goal's template_id for reference
      await supabase
        .from('goals')
        .update({ template_id: templateId })
        .eq('id', goalId)

      return tasks.length
    },
    onSuccess: invalidateGoals,
  })
}
