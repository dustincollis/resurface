import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import type { QueryKey } from '@tanstack/react-query'

let channelCounter = 0

interface UseRealtimeOptions {
  table: string
  schema?: string
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
  queryKey: QueryKey
}

export function useRealtimeSubscription({
  table,
  schema = 'public',
  event = '*',
  queryKey,
}: UseRealtimeOptions) {
  const idRef = useRef<number | null>(null)

  useEffect(() => {
    if (idRef.current === null) {
      idRef.current = ++channelCounter
    }
    const channelName = `${table}-changes-${idRef.current}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event, schema, table },
        () => {
          queryClient.invalidateQueries({ queryKey })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, schema, event, queryKey])
}
