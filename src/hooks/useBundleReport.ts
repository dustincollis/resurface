import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import type { BundleReport } from '../lib/types'

export function useBundleReport(bundleId: string) {
  return useQuery({
    queryKey: ['bundle_report', bundleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bundle_reports')
        .select('*')
        .eq('bundle_id', bundleId)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as BundleReport | null
    },
    enabled: !!bundleId,
  })
}

export function useGenerateBundleReport() {
  return useMutation({
    mutationFn: async (bundleId: string) => {
      const { data, error } = await supabase.functions.invoke('ai-bundle-report', {
        body: { bundle_id: bundleId },
      })
      if (error) {
        const ctx = (error as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json()
            throw new Error(body?.error ?? 'Report generation failed')
          } catch (e) {
            if (e instanceof Error) throw e
          }
        }
        throw error
      }
      return data as { ok: boolean; status: 'generating'; already_running?: boolean }
    },
    onSuccess: (_data, bundleId) => {
      // Refetch the bundle so its report_status flips to 'generating' and polling starts
      queryClient.invalidateQueries({ queryKey: ['bundle', bundleId] })
    },
  })
}
