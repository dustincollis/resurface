import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import type { ItemAssist, ItemAssistType } from '../lib/types'

export function useItemAssists(itemId: string) {
  useRealtimeSubscription({
    table: 'item_assists',
    queryKey: ['item_assists', itemId],
  })

  return useQuery({
    queryKey: ['item_assists', itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('item_assists')
        .select('*')
        .eq('item_id', itemId)
      if (error) throw error
      return data as ItemAssist[]
    },
    enabled: !!itemId,
  })
}

export function useGenerateItemAssist() {
  return useMutation({
    mutationFn: async ({
      itemId,
      assistType,
    }: {
      itemId: string
      assistType: ItemAssistType
    }) => {
      const { data, error } = await supabase.functions.invoke('ai-item-assist', {
        body: { item_id: itemId, assist_type: assistType },
      })
      if (error) {
        const ctx = (error as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json()
            throw new Error(body?.detail ?? body?.error ?? 'AI assist failed')
          } catch (parseErr) {
            if (parseErr instanceof Error) throw parseErr
          }
        }
        throw error
      }
      return data as ItemAssist
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['item_assists', vars.itemId] })
    },
  })
}
