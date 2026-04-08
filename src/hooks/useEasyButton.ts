import { useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { buildUserContext, formatUserContextBlock } from '../lib/userContext'

export interface EasyButtonResult {
  task: {
    id: string
    title: string
    description: string | null
    stream_name: string | null
    next_action: string | null
    due_date: string | null
    resistance: number | null
    stakes: number | null
  }
  guidance: string
}

export function useEasyButton() {
  return useMutation({
    mutationFn: async () => {
      const userContext = formatUserContextBlock(buildUserContext())
      const { data, error } = await supabase.functions.invoke('ai-easy-button', {
        body: { user_context: userContext },
      })
      if (error) throw error
      return data as EasyButtonResult
    },
  })
}
