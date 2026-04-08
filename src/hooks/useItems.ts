import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import type { Item, ItemStatus, CreateItemPayload, UpdateItemPayload } from '../lib/types'

interface ItemFilters {
  stream_id?: string
  status?: ItemStatus | ItemStatus[]
  sort_by?: 'staleness_score' | 'last_touched_at' | 'due_date' | 'created_at'
  sort_ascending?: boolean
  limit?: number
}

export function useItems(filters?: ItemFilters) {
  const { user } = useAuth()

  useRealtimeSubscription({
    table: 'items',
    queryKey: ['items'],
  })

  return useQuery({
    queryKey: ['items', filters],
    queryFn: async () => {
      let query = supabase
        .from('items')
        .select('*, streams(*)')

      if (filters?.stream_id) {
        query = query.eq('stream_id', filters.stream_id)
      }

      if (filters?.status) {
        if (Array.isArray(filters.status)) {
          query = query.in('status', filters.status)
        } else {
          query = query.eq('status', filters.status)
        }
      }

      const sortBy = filters?.sort_by ?? 'created_at'
      const ascending = filters?.sort_ascending ?? false
      query = query.order(sortBy, { ascending })

      if (filters?.limit) {
        query = query.limit(filters.limit)
      }

      const { data, error } = await query
      if (error) throw error
      return data as Item[]
    },
    enabled: !!user,
  })
}

export function useItemsByStream(streamId: string) {
  return useItems({ stream_id: streamId })
}

export function useItem(id: string) {
  return useQuery({
    queryKey: ['items', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select('*, streams(*), source_meeting:meetings!source_meeting_id(id, title)')
        .eq('id', id)
        .single()
      if (error) throw error
      return data as Item & { source_meeting?: { id: string; title: string } | null }
    },
    enabled: !!id,
  })
}

export function useCreateItem() {
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (payload: CreateItemPayload) => {
      const { data, error } = await supabase
        .from('items')
        .insert({ ...payload, user_id: user!.id })
        .select()
        .single()
      if (error) throw error
      return data as Item
    },
    onSuccess: (item) => {
      queryClient.invalidateQueries({ queryKey: ['items'] })

      // Log activity
      supabase.from('activity_log').insert({
        user_id: item.user_id,
        item_id: item.id,
        action: 'created',
        details: { title: item.title },
      })

      // Fire-and-forget AI classification
      supabase.functions.invoke('ai-classify', {
        body: { item_id: item.id },
      })
    },
  })
}

export function useUpdateItem() {
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({ id, ...updates }: UpdateItemPayload & { id: string }) => {
      const { data, error } = await supabase
        .from('items')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Item
    },
    onSuccess: (_item, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items'] })
      queryClient.invalidateQueries({ queryKey: ['items', variables.id] })

      // Log activity
      const changedFields = Object.keys(variables).filter(k => k !== 'id')
      supabase.from('activity_log').insert({
        user_id: user!.id,
        item_id: variables.id,
        action: changedFields.includes('status') ? 'status_changed' : 'field_updated',
        details: { fields: changedFields },
      })
    },
  })
}

export function useDeleteItem() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('items').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
}

export function useTouchItem() {
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('items')
        .update({ last_touched_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Item
    },
    onSuccess: (_data, itemId) => {
      queryClient.invalidateQueries({ queryKey: ['items'] })
      queryClient.invalidateQueries({ queryKey: ['items', itemId] })

      supabase.from('activity_log').insert({
        user_id: user!.id,
        item_id: itemId,
        action: 'touched',
      })
    },
  })
}
