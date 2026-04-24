import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import { buildUserContext, formatUserContextBlock } from '../lib/userContext'
import type { ReviewInput } from '../lib/types'

// Pending triage-skipped inputs for the logged-in user. Shown in a
// collapsible section on /proposals so the user can audit skips and
// force-process any that were misjudged.
export function useTriageSkippedInputs(limit = 25) {
  const { user } = useAuth()

  useRealtimeSubscription({ table: 'inputs', queryKey: ['inputs'] })

  return useQuery({
    queryKey: ['inputs', 'triage_skipped', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inputs')
        .select('*')
        .eq('triage_result', 'skipped')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data as ReviewInput[]
    },
    enabled: !!user,
  })
}

// "Process anyway" action: flip triage_result to 'actionable' and fire the
// existing ai-parse-input function so the user's override actually produces
// proposals.
export function useProcessSkippedAnyway() {
  return useMutation({
    mutationFn: async (input: ReviewInput) => {
      const { error: updErr } = await supabase
        .from('inputs')
        .update({
          triage_result: 'actionable',
          triage_reason: 'user override: process anyway',
        })
        .eq('id', input.id)
      if (updErr) throw updErr

      const userContext = formatUserContextBlock(buildUserContext())
      const { error: parseErr } = await supabase.functions.invoke('ai-parse-input', {
        body: { input_id: input.id, user_context: userContext },
      })
      if (parseErr) throw parseErr
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inputs'] })
      queryClient.invalidateQueries({ queryKey: ['proposals'] })
    },
  })
}
