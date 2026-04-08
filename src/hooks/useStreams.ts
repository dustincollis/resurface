import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import type { Stream, CreateStreamPayload, UpdateStreamPayload } from '../lib/types'

export function useStreams() {
  const { user } = useAuth()

  useRealtimeSubscription({
    table: 'streams',
    queryKey: ['streams'],
  })

  return useQuery({
    queryKey: ['streams'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('streams')
        .select('*')
        .eq('is_archived', false)
        .order('sort_order')
      if (error) throw error
      return data as Stream[]
    },
    enabled: !!user,
  })
}

export function useStream(id: string) {
  return useQuery({
    queryKey: ['streams', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('streams')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data as Stream
    },
    enabled: !!id,
  })
}

export function useCreateStream() {
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (payload: CreateStreamPayload) => {
      const { data, error } = await supabase
        .from('streams')
        .insert({ ...payload, user_id: user!.id })
        .select()
        .single()
      if (error) throw error
      return data as Stream
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams'] })
    },
  })
}

export function useUpdateStream() {
  return useMutation({
    mutationFn: async ({ id, ...updates }: UpdateStreamPayload & { id: string }) => {
      const { data, error } = await supabase
        .from('streams')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Stream
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams'] })
    },
  })
}

export function useReorderStreams() {
  return useMutation({
    mutationFn: async (orders: { id: string; sort_order: number }[]) => {
      const promises = orders.map(({ id, sort_order }) =>
        supabase.from('streams').update({ sort_order }).eq('id', id)
      )
      await Promise.all(promises)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams'] })
    },
  })
}

export function useArchiveStream() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('streams')
        .update({ is_archived: true })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams'] })
    },
  })
}
