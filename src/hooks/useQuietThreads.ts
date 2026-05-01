import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface QuietThread {
  entity_type: 'person' | 'company'
  entity_id: string
  entity_name: string
  last_mention_at: string
  prior_mention_count: number
  days_silent: number
}

export function useQuietThreads() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['utility', 'quiet'],
    queryFn: async () => {
      if (!user) return [] as QuietThread[]
      const { data, error } = await supabase.rpc('get_quiet_threads', {
        searching_user_id: user.id,
      })
      if (error) throw new Error(error.message)
      return (data ?? []) as QuietThread[]
    },
    enabled: !!user,
  })
}
