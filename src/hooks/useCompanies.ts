import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Company } from '../lib/types'

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
