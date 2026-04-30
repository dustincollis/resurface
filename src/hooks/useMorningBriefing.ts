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

export function useMorningBriefing() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['morning_briefing', todayLocal()],
    queryFn: async () => {
      const today = todayLocal()
      // First check if today's row already exists (avoids hitting the
      // Edge Function on every page reload).
      const { data: existing, error: existingErr } = await supabase
        .from('morning_briefings')
        .select('*')
        .eq('user_id', user!.id)
        .eq('briefing_date', today)
        .maybeSingle()
      if (existingErr) throw existingErr
      if (existing && existing.status === 'ready') {
        return existing as MorningBriefing
      }

      // Trigger generation via the Edge Function.
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
          body: JSON.stringify({}),
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

export function useRegenerateMorningBriefing() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not authenticated')
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
          body: JSON.stringify({ force: true }),
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
