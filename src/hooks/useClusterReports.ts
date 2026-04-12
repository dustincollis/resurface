import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'

export type ClusterReportType =
  | 'strategic_assessment'
  | 'action_plan'
  | 'competitive_landscape'
  | 'account_map'
  | 'trend_analysis'

export interface ClusterReport {
  id?: string
  cluster_id: string
  cluster_label: string
  report_type: ClusterReportType
  content: string
  generated_at: string
  from_cache?: boolean
}

export const REPORT_TYPE_LABELS: Record<ClusterReportType, string> = {
  strategic_assessment: 'Strategic Assessment',
  action_plan: 'Action Plan',
  competitive_landscape: 'Competitive Landscape',
  account_map: 'Account Map',
  trend_analysis: 'Trend Analysis',
}

export const REPORT_TYPE_DESCRIPTIONS: Record<ClusterReportType, string> = {
  strategic_assessment: 'What this theme means and what to do about it',
  action_plan: 'Specific next steps with owners and timelines',
  competitive_landscape: 'Where EPAM stands vs. competitors',
  account_map: 'Which accounts connect and where the white space is',
  trend_analysis: 'Is this growing, stalling, or ready to act on',
}

export function useClusterReport(clusterId: string, reportType: ClusterReportType) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['cluster_reports', clusterId, reportType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cluster_reports')
        .select('*')
        .eq('cluster_id', clusterId)
        .eq('report_type', reportType)
        .maybeSingle()
      if (error) throw error
      return data as ClusterReport | null
    },
    enabled: !!user && !!clusterId,
  })
}

export function useClusterReports(clusterId: string) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['cluster_reports', clusterId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cluster_reports')
        .select('*')
        .eq('cluster_id', clusterId)
      if (error) throw error
      return data as ClusterReport[]
    },
    enabled: !!user && !!clusterId,
  })
}

export function useGenerateClusterReport() {
  return useMutation({
    mutationFn: async ({
      cluster_id,
      report_type,
      regenerate = false,
    }: {
      cluster_id: string
      report_type: ClusterReportType
      regenerate?: boolean
    }) => {
      const { data, error } = await supabase.functions.invoke('ai-cluster-report', {
        body: { cluster_id, report_type, regenerate },
      })
      if (error) throw error
      return data as ClusterReport
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['cluster_reports', variables.cluster_id],
      })
      queryClient.invalidateQueries({
        queryKey: ['cluster_reports', variables.cluster_id, variables.report_type],
      })
    },
  })
}
