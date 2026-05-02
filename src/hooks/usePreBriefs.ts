import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export type PreBriefMeetingKind = 'one_off' | 'recurring' | 'large_meeting'
export type PreBriefContextStatus = 'ready' | 'no_embedding'

export interface TopicItem {
  id: string
  title: string
  snippet: string
  similarity: number
  created_at: string
}

export interface TopicCommitment extends TopicItem {
  status: string
  do_by: string | null
}

export interface TopicMeeting {
  id: string
  title: string
  start_time: string
  similarity: number
}

export interface SeriesOpenItem {
  source_type: 'commitment' | 'idea' | 'task'
  id: string
  title: string
  status: string
  do_by: string | null
  source_meeting_id: string
  source_meeting_title: string
  source_meeting_date: string
}

export interface PreBriefAttendee {
  raw: string
  person_id: string
  name: string
  company_id: string | null
  company_name: string | null
  open_commitments: Array<{ id: string; title: string; do_by: string | null; status: string }>
  recent_memories: Array<{ id: string; content: string; created_at: string }>
  prior_meeting_count: number
}

export interface PreBrief {
  meeting: {
    id: string
    title: string
    start_time: string
    location: string | null
    attendees_raw: string[]
    attendee_count: number
  }
  meeting_kind: PreBriefMeetingKind
  context_status: PreBriefContextStatus
  context_note: string | null

  // one_off branch
  topic_ideas?: TopicItem[]
  topic_memories?: TopicItem[]
  topic_commitments?: TopicCommitment[]
  similar_meetings?: TopicMeeting[]

  // recurring branch
  series_open_items?: SeriesOpenItem[]
  series_prior_instance_count?: number

  // both
  attendee_context: PreBriefAttendee[]
  unresolved_attendee_count: number
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
