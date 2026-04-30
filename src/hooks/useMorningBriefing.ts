import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import type { MorningBriefing } from '../lib/types'

// Today's date in the user's local timezone, as YYYY-MM-DD. The Edge
// Function does the same calc server-side using the profile's timezone;
// for the local query we just use the browser's locale, which matches
// in practice because the user is reading on their own device.
function todayLocal(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// `forDate` lets a caller preview an arbitrary date's briefing (e.g. the
// /morning page reads `?date=YYYY-MM-DD` from the URL for testing). When
// undefined, the function uses the user's "today" in their profile timezone.
export function useMorningBriefing(forDate?: string) {
  const { user } = useAuth()
  const targetDate = forDate && DATE_RE.test(forDate) ? forDate : todayLocal()

  return useQuery({
    queryKey: ['morning_briefing', targetDate],
    queryFn: async () => {
      const { data: existing, error: existingErr } = await supabase
        .from('morning_briefings')
        .select('*')
        .eq('user_id', user!.id)
        .eq('briefing_date', targetDate)
        .maybeSingle()
      if (existingErr) throw existingErr
      if (existing && existing.status === 'ready') {
        return existing as MorningBriefing
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not authenticated')

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-morning-briefing`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify(forDate && DATE_RE.test(forDate) ? { for_date: forDate } : {}),
        },
      )
      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`Briefing generation failed: ${resp.status} ${text.slice(0, 200)}`)
      }
      const result = (await resp.json()) as MorningBriefing
      return result
    },
    enabled: !!user,
    staleTime: 60 * 60 * 1000, // 1 hour: snapshot semantics
  })
}

export function useRegenerateMorningBriefing(forDate?: string) {
  const { user } = useAuth()
  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not authenticated')
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not authenticated')
      const payload: Record<string, unknown> = { force: true }
      if (forDate && DATE_RE.test(forDate)) payload.for_date = forDate
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-morning-briefing`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify(payload),
        },
      )
      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`Regenerate failed: ${resp.status} ${text.slice(0, 200)}`)
      }
      return (await resp.json()) as MorningBriefing
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['morning_briefing'] })
    },
  })
}
