import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import type { ItemNote } from '../lib/types'

export function useItemNotes(itemId: string) {
  useRealtimeSubscription({
    table: 'item_notes',
    queryKey: ['item_notes', itemId],
  })

  return useQuery({
    queryKey: ['item_notes', itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('item_notes')
        .select('*')
        .eq('item_id', itemId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as ItemNote[]
    },
    enabled: !!itemId,
  })
}

export function useAddItemNote() {
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({ itemId, content }: { itemId: string; content: string }) => {
      const { data, error } = await supabase
        .from('item_notes')
        .insert({ user_id: user!.id, item_id: itemId, content })
        .select()
        .single()
      if (error) throw error
      return data as ItemNote
    },
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ['item_notes', note.item_id] })

      // Touch the item's last_touched_at
      supabase
        .from('items')
        .update({ last_touched_at: new Date().toISOString() })
        .eq('id', note.item_id)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['items'] })
          queryClient.invalidateQueries({ queryKey: ['items', note.item_id] })
        })

      // Log activity
      supabase.from('activity_log').insert({
        user_id: note.user_id,
        item_id: note.item_id,
        action: 'note_added',
        details: {},
      })
    },
  })
}
