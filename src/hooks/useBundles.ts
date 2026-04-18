import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import type { Bundle, BundleDocument, BundleEntity, BundleGap, CreateBundlePayload } from '../lib/types'

// ============================================================
// List all bundles for the current user
// ============================================================
export function useBundles() {
  return useQuery({
    queryKey: ['bundles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bundles')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Bundle[]
    },
  })
}

// ============================================================
// Single bundle with documents, entities, and gaps
// ============================================================
export function useBundle(bundleId: string) {
  return useQuery({
    queryKey: ['bundle', bundleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bundles')
        .select('*')
        .eq('id', bundleId)
        .single()
      if (error) throw error
      return data as Bundle
    },
    enabled: !!bundleId,
    refetchInterval: (query) => {
      // Poll while ingesting so status updates show in real time
      return query.state.data?.status === 'ingesting' ? 2000 : false
    },
  })
}

export function useBundleDocuments(bundleId: string) {
  return useQuery({
    queryKey: ['bundle_documents', bundleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bundle_documents')
        .select('*')
        .eq('bundle_id', bundleId)
        .order('position')
      if (error) throw error
      return data as BundleDocument[]
    },
    enabled: !!bundleId,
  })
}

export function useBundleEntities(bundleId: string) {
  return useQuery({
    queryKey: ['bundle_entities', bundleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bundle_entities')
        .select('*')
        .eq('bundle_id', bundleId)
        .order('mention_count', { ascending: false })
      if (error) throw error
      return data as BundleEntity[]
    },
    enabled: !!bundleId,
  })
}

export function useBundleGaps(bundleId: string) {
  return useQuery({
    queryKey: ['bundle_gaps', bundleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bundle_gaps')
        .select('*')
        .eq('bundle_id', bundleId)
        .order('position')
      if (error) throw error
      return data as BundleGap[]
    },
    enabled: !!bundleId,
  })
}

// ============================================================
// Create a bundle (metadata only — ingest happens separately)
// ============================================================
function extractError(err: unknown): Error {
  if (err instanceof Error) return err
  if (err && typeof err === 'object' && 'message' in err) {
    return new Error(String((err as { message: unknown }).message))
  }
  return new Error(String(err))
}

export function useCreateBundle() {
  return useMutation({
    mutationFn: async (payload: CreateBundlePayload) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      const { data, error } = await supabase
        .from('bundles')
        .insert({ ...payload, user_id: user.id })
        .select()
        .single()
      if (error) throw extractError(error)
      return data as Bundle
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bundles'] })
    },
  })
}

// ============================================================
// Ingest documents into a bundle (calls edge function)
// ============================================================
export function useIngestBundle() {
  return useMutation({
    mutationFn: async ({
      bundleId,
      documents,
    }: {
      bundleId: string
      documents: { title: string; content_md: string }[]
    }) => {
      const { data, error } = await supabase.functions.invoke('ai-bundle-ingest', {
        body: { bundle_id: bundleId, documents },
      })
      if (error) {
        const ctx = (error as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json()
            throw new Error(body?.error ?? body?.message ?? 'Ingest failed')
          } catch (e) {
            if (e instanceof Error) throw e
          }
        }
        throw extractError(error)
      }
      return data as { ok: boolean; chunks: number; people: number; companies: number; gaps: number }
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['bundle', vars.bundleId] })
      queryClient.invalidateQueries({ queryKey: ['bundle_documents', vars.bundleId] })
      queryClient.invalidateQueries({ queryKey: ['bundle_entities', vars.bundleId] })
      queryClient.invalidateQueries({ queryKey: ['bundle_gaps', vars.bundleId] })
    },
  })
}

// ============================================================
// Toggle gap state
// ============================================================
export function useUpdateBundleGap() {
  return useMutation({
    mutationFn: async ({ gapId, state }: { gapId: string; state: BundleGap['state']; bundleId: string }) => {
      const { error } = await supabase
        .from('bundle_gaps')
        .update({ state, updated_at: new Date().toISOString() })
        .eq('id', gapId)
      if (error) throw extractError(error)
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['bundle_gaps', vars.bundleId] })
    },
  })
}

// ============================================================
// Delete a bundle (cascades to all child tables)
// ============================================================
export function useDeleteBundle() {
  return useMutation({
    mutationFn: async (bundleId: string) => {
      const { error } = await supabase.from('bundles').delete().eq('id', bundleId)
      if (error) throw extractError(error)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bundles'] })
    },
  })
}
