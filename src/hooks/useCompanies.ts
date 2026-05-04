import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Company, PartnerDocument, PartnerDocumentKind } from '../lib/types'

export function useCompanies() {
  return useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .order('name')
      if (error) throw error
      return data as Company[]
    },
  })
}

/**
 * Companies tagged as content partners — the platforms whose products
 * EPAM sells/implements (Adobe, Sitecore, Contentful, etc.). Returns the
 * company row plus a count of people you know there, so the list page
 * can show roster size without N+1 queries. Sorted by name.
 */
export interface PartnerSummary extends Company {
  people_count: number
}

export function usePartners() {
  return useQuery({
    queryKey: ['companies', 'partners'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('*, people(count)')
        .eq('kind', 'partner')
        .order('name')
      if (error) throw error
      // Supabase nests the count under people: [{count: N}]; flatten it.
      return ((data ?? []) as Array<Company & { people: Array<{ count: number }> }>).map(
        (row) => ({
          ...row,
          people_count: row.people?.[0]?.count ?? 0,
        }),
      ) as PartnerSummary[]
    },
  })
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: ['companies', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as Company
    },
  })
}

/** All people at this company */
export function useCompanyPeople(companyId: string | undefined) {
  return useQuery({
    queryKey: ['companies', companyId, 'people'],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('people')
        .select('*')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })
}

/** All pursuits linked to this company */
export function useCompanyPursuits(companyId: string | undefined) {
  return useQuery({
    queryKey: ['companies', companyId, 'pursuits'],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pursuits')
        .select('*')
        .eq('company_id', companyId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/** All commitments linked to this company */
export function useCompanyCommitments(companyId: string | undefined) {
  return useQuery({
    queryKey: ['companies', companyId, 'commitments'],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commitments')
        .select('*')
        .eq('company_id', companyId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

export interface CompanyRollup {
  people_count: number
  open_commitments_count: number
  open_ideas_count: number
  recent_meetings: Array<{ id: string; title: string; start_time: string }>
  open_commitments: Array<{ id: string; title: string; status: string; do_by: string | null }>
  surfaced_ideas: Array<{ id: string; title: string; status: string; created_at: string }>
  weekly_momentum: number[]
}

export function useCompanyRollup(companyId: string | undefined) {
  return useQuery({
    queryKey: ['companies', companyId, 'rollup'],
    enabled: !!companyId,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data, error } = await supabase.rpc('get_company_rollup', {
        p_company_id: companyId!,
        searching_user_id: user.id,
      })
      if (error) throw new Error(error.message)
      return ((data ?? [])[0] ?? null) as CompanyRollup | null
    },
    staleTime: 10 * 60 * 1000,
  })
}

/**
 * Joint pursuits for a partner company — every pursuit whose meetings,
 * commitments, or items reference this partner. Returned with a per-
 * channel touch breakdown so the UI can show "5 touches: 3 meetings, 2
 * items" rather than a flat number. Active pursuits sort first.
 *
 * Only meaningful when the company is kind='partner'; the page gates
 * the call accordingly.
 */
export interface JointPursuit {
  pursuit_id: string
  pursuit_name: string
  pursuit_status: string
  touch_count: number
  via_meetings: number
  via_commitments: number
  via_items: number
  most_recent_touch: string
}

export function useCompanyJointPursuits(companyId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['companies', companyId, 'joint_pursuits'],
    enabled: !!companyId && enabled,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      const { data, error } = await supabase.rpc('get_partner_joint_pursuits', {
        partner_id: companyId!,
        searching_user_id: user.id,
      })
      if (error) throw error
      return (data ?? []) as JointPursuit[]
    },
  })
}

/**
 * Partner activity feed — meetings the partner attended, with the
 * cross-references resolved server-side: follow-up count, items count,
 * commitments count, and related companies (other accounts mentioned in
 * the meeting). Most-recent first; the UI windows to last 30 days by
 * default and reveals older on "Show more".
 *
 * Only meaningful when company.kind='partner'; the page gates the call.
 */
export interface PartnerActivityCompany {
  id: string
  name: string
  kind: 'partner' | 'client' | 'internal' | 'other' | 'unknown'
}

export interface PartnerMeetingActivity {
  meeting_id: string
  meeting_title: string
  start_time: string | null
  follow_ups_count: number
  items_count: number
  commitments_count: number
  related_companies: PartnerActivityCompany[]
  // Names from the parser's mentioned_companies that don't resolve to a
  // companies row. Surfaced as plain-text chips so the user can still see
  // the mention before they create the company.
  mentioned_only_names: string[]
}

export function useCompanyPartnerActivity(companyId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['companies', companyId, 'partner_activity'],
    enabled: !!companyId && enabled,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      const { data, error } = await supabase.rpc('get_partner_activity', {
        partner_id: companyId!,
        searching_user_id: user.id,
      })
      if (error) throw error
      return (data ?? []) as PartnerMeetingActivity[]
    },
  })
}

// ============================================================
// Partner reference documents — uploaded files (org charts, team
// alignments, capability briefs) tied to a partner. Processing happens
// server-side via the process-partner-document Edge Function, which
// extracts text, summarizes, and uses the identity resolver to upsert
// people rows tied to the partner.
// ============================================================

export function usePartnerDocuments(companyId: string | undefined) {
  return useQuery({
    queryKey: ['companies', companyId, 'documents'],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('partner_documents')
        .select('*')
        .eq('company_id', companyId!)
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as PartnerDocument[]
    },
  })
}

interface UploadPartnerDocArgs {
  companyId: string
  file: File
  title?: string
  kind?: PartnerDocumentKind
}

export function useUploadPartnerDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ companyId, file, title, kind }: UploadPartnerDocArgs) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Path convention: {user_id}/{company_id}/{uuid}-{filename}. RLS on
      // storage.objects enforces that the first path segment matches the
      // authenticated user, so users can only write to their own folder.
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_')
      const storagePath = `${user.id}/${companyId}/${crypto.randomUUID()}-${safeName}`

      const { error: uploadErr } = await supabase
        .storage
        .from('partner-docs')
        .upload(storagePath, file, { contentType: file.type, upsert: false })
      if (uploadErr) throw uploadErr

      const { data: row, error: insertErr } = await supabase
        .from('partner_documents')
        .insert({
          user_id: user.id,
          company_id: companyId,
          title: title?.trim() || file.name,
          kind: kind ?? 'other',
          original_filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          storage_path: storagePath,
          size_bytes: file.size,
        })
        .select()
        .single()
      if (insertErr) throw insertErr
      const doc = row as PartnerDocument

      // Kick off processing — fire-and-forget. The function updates the
      // row in place; the UI refetches when it sees processed_at populated.
      // We don't await so the upload feels instant; failures land in
      // processing_error and surface on the card.
      supabase.functions
        .invoke('process-partner-document', { body: { document_id: doc.id } })
        .catch((err) => console.warn('[partner-doc] processing kickoff failed:', err))

      return doc
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['companies', vars.companyId, 'documents'] })
      qc.invalidateQueries({ queryKey: ['companies', vars.companyId, 'people'] })
      qc.invalidateQueries({ queryKey: ['companies', vars.companyId, 'rollup'] })
    },
  })
}

export function useDeletePartnerDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, companyId, storagePath }: {
      id: string
      companyId: string
      storagePath: string
    }) => {
      // Best-effort storage delete first; if it fails we still want the
      // table row gone so the UI doesn't keep showing it.
      await supabase.storage.from('partner-docs').remove([storagePath])
      const { error } = await supabase.from('partner_documents').delete().eq('id', id)
      if (error) throw error
      return { id, companyId }
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['companies', data.companyId, 'documents'] })
    },
  })
}

export function useReprocessPartnerDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, companyId }: { id: string; companyId: string }) => {
      // Clear any prior error + processed_at so the row shows as in-flight,
      // then trigger the function again.
      await supabase
        .from('partner_documents')
        .update({ processed_at: null, processing_error: null })
        .eq('id', id)
      const { error } = await supabase.functions.invoke('process-partner-document', {
        body: { document_id: id },
      })
      if (error) throw error
      return { id, companyId }
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['companies', data.companyId, 'documents'] })
      qc.invalidateQueries({ queryKey: ['companies', data.companyId, 'people'] })
    },
  })
}

export function useUpdateCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<Omit<Company, 'id' | 'user_id' | 'created_at' | 'updated_at'>>) => {
      const { data, error } = await supabase
        .from('companies')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Company
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['companies'] })
      qc.setQueryData(['companies', data.id], data)
    },
  })
}

export function useCreateCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { name: string; domain?: string; notes?: string }) => {
      const { data, error } = await supabase
        .from('companies')
        .insert(payload)
        .select()
        .single()
      if (error) throw error
      return data as Company
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] })
    },
  })
}
