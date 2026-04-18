import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import type { Memory } from '../lib/userContext'

export function useMemories() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['memories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memories')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Memory[]
    },
    enabled: !!user,
  })
}

export function useDeleteMemory() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('memories').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memories'] })
    },
  })
}

// Manual memory entry — the user is trusted, so we write directly to the
// table instead of routing through a proposal.
export function useAddMemory() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) throw new Error('Memory cannot be empty')
      const { data, error } = await supabase
        .from('memories')
        .insert({
          user_id: user!.id,
          content: trimmed,
          source: 'user_added',
        })
        .select()
        .single()
      if (error) throw error
      return data as Memory
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memories'] })
    },
  })
}
