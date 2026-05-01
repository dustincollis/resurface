import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface PreBrief {
  meeting: {
    id: string
    title: string
    start_time: string
    location: string | null
    attendees_raw: string[]
  }
  attendees: Array<{
    raw: string
    person_id: string | null
    name: string
    company_id: string | null
    company_name: string | null
    open_commitments: Array<{ id: string; title: string; do_by: string | null; status: string }>
    recent_memories: Array<{ id: string; content: string; created_at: string }>
    recent_ideas: Array<{ id: string; title: string; created_at: string }>
    prior_meetings: Array<{ id: string; title: string; start_time: string }>
  }>
  primary_company: {
    id: string
    name: string
    open_company_ideas: Array<{ id: string; title: string }>
    open_company_commitments: Array<{ id: string; title: string; status: string }>
  } | null
}

export function usePreBriefs() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['utility', 'prebriefs'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not authenticated')

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-prebriefs`,
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
      if (!resp.ok) throw new Error(`Pre-briefs failed (${resp.status})`)
      return (await resp.json()) as PreBrief[]
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  })
}
