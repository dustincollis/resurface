import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import type { ChatMessage } from '../lib/types'

export interface FileAttachment {
  name: string
  type: string
  data: string // base64
}

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
    mutationFn: async ({ message, chatHistory, attachments }: {
      message: string
      chatHistory: ChatMessage[]
      attachments?: FileAttachment[]
    }) => {
      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: {
          message,
          chat_history: chatHistory.slice(-20).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          attachments,
        },
      })

      if (error) throw error
      return data as { message: string; actions_taken: string[] }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat_messages'] })
      queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
}

export function fileToAttachment(file: File): Promise<FileAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1]
      resolve({ name: file.name, type: file.type, data: base64 })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
