import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { SearchResult } from '../lib/types'

export function useSearch(query: string, enabled: boolean) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['search', query],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_everything', {
        search_query: query,
        searching_user_id: user!.id,
        max_results: 20,
      })
      if (error) throw error
      return data as SearchResult[]
    },
    enabled: enabled && !!user && query.length >= 2,
    staleTime: 30 * 1000,
  })
}
