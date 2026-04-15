import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import { buildUserContext, formatUserContextBlock } from '../lib/userContext'
import type { Item, ItemStatus, CreateItemPayload, UpdateItemPayload } from '../lib/types'

interface ItemFilters {
  stream_id?: string
  status?: ItemStatus | ItemStatus[]
  sort_by?: 'staleness_score' | 'last_touched_at' | 'due_date' | 'created_at'
  sort_ascending?: boolean
  limit?: number
  // When true (the default), items with parent_id IS NOT NULL are excluded
  // from the result. Children only render inside their parent's detail view
  // via useChildItems. Pass `false` to opt back into a flat list (e.g.
  // Stream Kanban or any debug view).
  exclude_children?: boolean
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

      // Hide children of grouped items by default. Children are only
      // surfaced inside the parent's detail view (via useChildItems).
      const excludeChildren = filters?.exclude_children ?? true
      if (excludeChildren) {
        query = query.is('parent_id', null)
      }

      const sortBy = filters?.sort_by ?? 'created_at'
      const ascending = filters?.sort_ascending ?? false
      query = query.order(sortBy, { ascending })

      if (filters?.limit) {
        query = query.limit(filters.limit)
      }

      const { data, error } = await query
      if (error) throw error
      const items = data as Item[]

      // Attach open child counts to any parent items so the UI can show a
      // "N open tasks" chip. One extra query covers all parents at once.
      if (items.length > 0) {
        const parentIds = items.map((i) => i.id)
        const { data: childRows } = await supabase
          .from('items')
          .select('parent_id')
          .in('parent_id', parentIds)
          .in('status', ['open', 'in_progress', 'waiting'])
        const counts = new Map<string, number>()
        for (const row of (childRows ?? []) as Array<{ parent_id: string }>) {
          counts.set(row.parent_id, (counts.get(row.parent_id) ?? 0) + 1)
        }
        for (const item of items) {
          const c = counts.get(item.id)
          if (c && c > 0) item.open_children_count = c
        }
      }

      return items
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
        .select('*, streams(*), source_meeting:meetings!source_meeting_id(id, title), parent:items!parent_id(id, title)')
        .eq('id', id)
        .single()
      if (error) throw error
      return data as Item & {
        source_meeting?: { id: string; title: string } | null
        parent?: { id: string; title: string } | null
      }
    },
    enabled: !!id,
  })
}

export function useChildItems(parentId: string) {
  return useQuery({
    queryKey: ['items', 'children', parentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select('*, streams(*)')
        .eq('parent_id', parentId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as Item[]
    },
    enabled: !!parentId,
  })
}

export function useUncategorizedItems() {
  const { user } = useAuth()

  useRealtimeSubscription({
    table: 'items',
    queryKey: ['items'],
  })

  return useQuery({
    queryKey: ['items', 'uncategorized'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select('*, streams(*)')
        .is('stream_id', null)
        .is('parent_id', null)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Item[]
    },
    enabled: !!user,
  })
}

export function useItemsByDiscussion(meetingId: string) {
  return useQuery({
    queryKey: ['items', 'discussion', meetingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select('*, streams(*)')
        .eq('source_meeting_id', meetingId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as Item[]
    },
    enabled: !!meetingId,
  })
}

export interface ProposedSubTask {
  title: string
  description: string
  next_action: string
  suggested_due_date: string | null
}

export function useDecomposeItem() {
  return useMutation({
    mutationFn: async (itemId: string) => {
      const userContext = formatUserContextBlock(buildUserContext())
      const { data, error } = await supabase.functions.invoke('ai-decompose', {
        body: { item_id: itemId, user_context: userContext },
      })
      if (error) throw error
      return data as { sub_tasks: ProposedSubTask[]; parent_stream_id: string | null }
    },
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
      const userContext = formatUserContextBlock(buildUserContext())
      supabase.functions.invoke('ai-classify', {
        body: { item_id: item.id, user_context: userContext },
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

// Next business day: skips weekends so Friday → Monday, Saturday → Monday,
// Sunday → Monday. Weekdays → next day as before.
function nextBusinessDay(from: Date): Date {
  const result = new Date(from)
  const day = result.getDay() // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  if (day === 5) result.setDate(result.getDate() + 3)       // Fri → Mon
  else if (day === 6) result.setDate(result.getDate() + 2)  // Sat → Mon
  else result.setDate(result.getDate() + 1)                 // Sun-Thu → next day
  // Snooze until start of day so items reappear first thing in the morning
  result.setHours(0, 0, 0, 0)
  return result
}

export function useTouchItem() {
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (id: string) => {
      const now = new Date()
      const snoozeUntil = nextBusinessDay(now)
      const { data, error } = await supabase
        .from('items')
        .update({
          last_touched_at: now.toISOString(),
          snoozed_until: snoozeUntil.toISOString(),
        })
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
        details: { snoozed_until: nextBusinessDay(new Date()).toISOString() },
      })
    },
  })
}

export function useTogglePin() {
  return useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const { error } = await supabase
        .from('items')
        .update({ pinned })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items'] })
      queryClient.invalidateQueries({ queryKey: ['items', variables.id] })
    },
  })
}

// Manual unsnooze (e.g. if user wants the item back today)
export function useUnsnoozeItem() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('items')
        .update({ snoozed_until: null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
}
