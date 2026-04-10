import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import type { Template, TemplateStep, TemplateType } from '../lib/types'

export function useTemplates(type?: TemplateType) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['templates', type],
    queryFn: async () => {
      let query = supabase.from('templates').select('*')
      if (type) query = query.eq('template_type', type)
      const { data, error } = await query.order('name')
      if (error) throw error
      return data as Template[]
    },
    enabled: !!user,
  })
}

export function useTemplateSteps(templateId: string) {
  return useQuery({
    queryKey: ['template_steps', templateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('template_steps')
        .select('*')
        .eq('template_id', templateId)
        .order('sort_order')
      if (error) throw error
      return data as TemplateStep[]
    },
    enabled: !!templateId,
  })
}

function invalidateTemplates() {
  queryClient.invalidateQueries({ queryKey: ['templates'] })
  queryClient.invalidateQueries({ queryKey: ['template_steps'] })
}

export function useCreateTemplate() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (payload: {
      name: string
      description?: string | null
      template_type: TemplateType
    }) => {
      const { data, error } = await supabase
        .from('templates')
        .insert({ ...payload, user_id: user!.id })
        .select()
        .single()
      if (error) throw error
      return data as Template
    },
    onSuccess: invalidateTemplates,
  })
}

export function useUpdateTemplate() {
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string
      name?: string
      description?: string | null
    }) => {
      const { error } = await supabase
        .from('templates')
        .update(updates)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidateTemplates,
  })
}

export function useDeleteTemplate() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('templates').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidateTemplates,
  })
}

export function useAddTemplateStep() {
  return useMutation({
    mutationFn: async (payload: {
      template_id: string
      title: string
      description?: string | null
      sort_order: number
    }) => {
      const { data, error } = await supabase
        .from('template_steps')
        .insert(payload)
        .select()
        .single()
      if (error) throw error
      return data as TemplateStep
    },
    onSuccess: invalidateTemplates,
  })
}

export function useUpdateTemplateStep() {
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string
      title?: string
      description?: string | null
      sort_order?: number
    }) => {
      const { error } = await supabase
        .from('template_steps')
        .update(updates)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidateTemplates,
  })
}

export function useDeleteTemplateStep() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('template_steps').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidateTemplates,
  })
}

export function useReorderTemplateSteps() {
  return useMutation({
    mutationFn: async (steps: { id: string; sort_order: number }[]) => {
      for (const step of steps) {
        await supabase
          .from('template_steps')
          .update({ sort_order: step.sort_order })
          .eq('id', step.id)
      }
    },
    onSuccess: invalidateTemplates,
  })
}
