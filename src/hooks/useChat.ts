import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import type { ChatMessage } from '../lib/types'

export function useChatMessages() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['chat_messages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(100)
      if (error) throw error
      return data as ChatMessage[]
    },
    enabled: !!user,
  })
}

export function useSendMessage() {
  return useMutation({
    mutationFn: async ({ message, chatHistory }: {
      message: string
      chatHistory: ChatMessage[]
    }) => {
      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: {
          message,
          chat_history: chatHistory.slice(-20).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        },
      })

      if (error) throw error
      return data as { message: string; actions_taken: string[] }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat_messages'] })
      // Also refresh items in case the AI created/updated any
      queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
}
