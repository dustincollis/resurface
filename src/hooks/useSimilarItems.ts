import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export type SimilarSourceTable = 'ideas' | 'memories' | 'commitments' | 'meetings'

export interface SimilarItem {
  result_table: SimilarSourceTable
  result_id: string
  title: string
  snippet: string | null
  created_at: string | null
  similarity: number
}

export interface SimilarSource {
  source_table: SimilarSourceTable
  source_id: string
  title: string
  snippet: string | null
  created_at: string | null
  rank: number
}

export function useSimilarItems(
  sourceTable: SimilarSourceTable | null,
  sourceId: string | null,
  maxResults = 8,
) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['utility', 'similar', sourceTable, sourceId, maxResults],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('find_similar', {
        source_table: sourceTable,
        source_id: sourceId,
        searching_user_id: user!.id,
        max_results: maxResults,
      })
      if (error) throw error
      return data as SimilarItem[]
    },
    enabled: !!user && !!sourceTable && !!sourceId,
    staleTime: 5 * 60 * 1000,
  })
}

export function useSimilarSources(query: string) {
  const { user } = useAuth()
  const trimmed = query.trim()

  return useQuery({
    queryKey: ['utility', 'similar-sources', trimmed],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_similar_sources', {
        search_query: trimmed,
        searching_user_id: user!.id,
        max_results: 20,
      })
      if (error) throw error
      return data as SimilarSource[]
    },
    enabled: !!user && trimmed.length >= 2,
    staleTime: 30 * 1000,
  })
}
