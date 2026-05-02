import { useQuery, useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'

// Surfaces the count of rows in each corpus table that still need embeddings,
// and exposes a mutation that runs the backfill in batches from the browser.
//
// The Edge Function processes up to 200 rows per call. We loop until it
// reports zero, refreshing the UI's count between calls. Per-batch progress
// is exposed via state so the page can show "X / Y embedded" without us
// keeping a separate counter in the component.

const TABLES = ['ideas', 'memories', 'commitments', 'meetings'] as const
export type EmbeddingTable = (typeof TABLES)[number]

export interface EmbeddingStatus {
  ideas: { missing: number; total: number }
  memories: { missing: number; total: number }
  commitments: { missing: number; total: number }
  meetings: { missing: number; total: number }
  total_missing: number
  total_rows: number
}

export function useEmbeddingStatus() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['embedding_status'],
    queryFn: async () => {
      const status: Partial<Record<EmbeddingTable, { missing: number; total: number }>> = {}
      let totalMissing = 0
      let totalRows = 0
      for (const table of TABLES) {
        const [totalRes, missingRes] = await Promise.all([
          supabase.from(table).select('id', { count: 'exact', head: true }),
          supabase.from(table).select('id', { count: 'exact', head: true }).is('embedding', null),
        ])
        const total = totalRes.count ?? 0
        const missing = missingRes.count ?? 0
        status[table] = { total, missing }
        totalMissing += missing
        totalRows += total
      }
      return { ...(status as EmbeddingStatus), total_missing: totalMissing, total_rows: totalRows }
    },
    enabled: !!user,
    staleTime: 30 * 1000,
  })
}

export interface BackfillProgress {
  embedded: number
  runs: number
  done: boolean
}

export function useRunEmbeddingBackfill() {
  const [progress, setProgress] = useState<BackfillProgress>({ embedded: 0, runs: 0, done: false })

  const mutation = useMutation({
    mutationFn: async () => {
      setProgress({ embedded: 0, runs: 0, done: false })
      let totalEmbedded = 0
      // Cap at 100 iterations as a safety. With 200/batch that covers 20k rows.
      for (let run = 1; run <= 100; run += 1) {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('Not authenticated')
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/embed-corpus`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ mode: 'backfill' }),
          },
        )
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}))
          throw new Error(body?.error ?? `Backfill batch ${run} failed (${resp.status})`)
        }
        const body = await resp.json()
        const embedded = Number(body.embedded ?? 0)
        totalEmbedded += embedded
        setProgress({ embedded: totalEmbedded, runs: run, done: false })
        // Refresh the status query so the UI reflects the shrinking backlog.
        queryClient.invalidateQueries({ queryKey: ['embedding_status'] })
        if (embedded === 0) break
      }
      setProgress((p) => ({ ...p, done: true }))
      return totalEmbedded
    },
  })

  return { ...mutation, progress }
}
