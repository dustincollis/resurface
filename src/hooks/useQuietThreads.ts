import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface QuietThread {
  user_id?: string
  entity_type: 'person' | 'company'
  entity_id: string
  entity_name: string
  last_mention_at: string
  prior_mention_count: number
  days_silent: number
  refreshed_at?: string
}

export function useQuietThreads() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['utility', 'quiet'],
    queryFn: async () => {
      if (!user) return [] as QuietThread[]
      const { data, error } = await supabase
        .from('utility_quiet_threads')
        .select('*')
        .order('days_silent', { ascending: false })
        .order('prior_mention_count', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as QuietThread[]
    },
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
  })
}
