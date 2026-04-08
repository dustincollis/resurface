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
