import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'

// On-demand thematic analysis of the user's corpus. Each row is one snapshot
// — the AI read everything (ideas + memories + outgoing commitments) and
// produced a set of themes plus one-offs worth flagging. Reports are kept
// indefinitely so the user can scroll back and see how thinking has shifted.

export interface ThemeEvidence {
  source_type: 'idea' | 'memory' | 'commitment'
  source_id: string
  meeting_title: string
  meeting_date: string
  quote: string
  person: string
  company: string
}

export interface Theme {
  title: string
  evidence: ThemeEvidence[]
  why_it_matters: string
  next_move: string
}

export interface OneOff {
  signal: string
  source_type: 'idea' | 'memory' | 'commitment'
  source_id: string
  meeting_title: string
  meeting_date: string
  why_watch: string
}

export type ThemeReportStatus = 'generating' | 'ready' | 'failed'

export interface ThemeReport {
  id: string
  user_id: string
  report_type: string
  status: ThemeReportStatus
  error_text: string | null
  intro: string | null
  themes: Theme[]
  one_offs: OneOff[]
  input_summary: {
    ideas_count: number
    memories_count: number
    commitments_count: number
    claude_ms?: number
    usage?: { input_tokens?: number; output_tokens?: number }
    stage?: string
  } | null
  model: string | null
  created_at: string
}

export function useThemeReports() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['theme_reports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('theme_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data as ThemeReport[]
    },
    enabled: !!user,
    // Poll while any visible report is still generating. The Edge
    // Function returns the stub immediately and runs the analysis in
    // the background; the row's status flips when it's done. Stop
    // polling otherwise so we're not hammering the DB.
    refetchInterval: (query) => {
      const data = query.state.data as ThemeReport[] | undefined
      if (!data) return false
      const anyGenerating = data.some((r) => r.status === 'generating')
      return anyGenerating ? 3000 : false
    },
  })
}

export function useRunThemeAnalysis() {
  return useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not authenticated')
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-analyze-themes`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({}),
        },
      )
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        throw new Error(body?.detail ?? body?.error ?? `Analysis failed (${resp.status})`)
      }
      const body = await resp.json()
      return body.report as ThemeReport
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme_reports'] })
    },
  })
}
