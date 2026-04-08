import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { ActivityLogEntry } from '../lib/types'

export function useActivityLog(itemId: string) {
  return useQuery({
    queryKey: ['activity', itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_log')
        .select('*')
        .eq('item_id', itemId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as ActivityLogEntry[]
    },
    enabled: !!itemId,
  })
}
