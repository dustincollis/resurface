import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import type { ChatMessage } from '../lib/types'

export function useBundleChat(bundleId: string) {
  return useQuery({
    queryKey: ['bundle_chat', bundleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('scope_type', 'bundle')
        .eq('scope_id', bundleId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as ChatMessage[]
    },
    enabled: !!bundleId,
  })
}

export function useSendBundleChatMessage() {
  return useMutation({
    mutationFn: async ({ bundleId, message }: { bundleId: string; message: string }) => {
      const { data, error } = await supabase.functions.invoke('ai-bundle-chat', {
        body: { bundle_id: bundleId, message },
      })
      if (error) {
        const ctx = (error as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json()
            throw new Error(body?.error ?? 'Chat failed')
          } catch (e) {
            if (e instanceof Error) throw e
          }
        }
        throw error
      }
      return data as { role: 'assistant'; content: string }
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['bundle_chat', vars.bundleId] })
    },
  })
}
