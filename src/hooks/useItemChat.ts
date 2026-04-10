import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import type { ChatMessage } from '../lib/types'

export function useItemChat(itemId: string) {
  useRealtimeSubscription({
    table: 'chat_messages',
    queryKey: ['item_chat', itemId],
  })

  return useQuery({
    queryKey: ['item_chat', itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('scope_type', 'item')
        .eq('scope_id', itemId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as ChatMessage[]
    },
    enabled: !!itemId,
  })
}

export function useSendItemChatMessage() {
  return useMutation({
    mutationFn: async ({
      itemId,
      message,
    }: {
      itemId: string
      message: string
    }) => {
      const { data, error } = await supabase.functions.invoke('ai-item-chat', {
        body: { item_id: itemId, message },
      })
      if (error) {
        const ctx = (error as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json()
            throw new Error(body?.detail ?? body?.error ?? 'Chat failed')
          } catch (parseErr) {
            if (parseErr instanceof Error) throw parseErr
          }
        }
        throw error
      }
      return data as { user_message: ChatMessage; assistant_message: ChatMessage }
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['item_chat', vars.itemId] })
    },
  })
}
