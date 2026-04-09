import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import { buildUserContext, formatUserContextBlock } from '../lib/userContext'

export type MeetingImportMode = 'active' | 'archive'

export interface Meeting {
  id: string
  user_id: string
  ics_uid: string | null
  title: string
  start_time: string | null
  end_time: string | null
  location: string | null
  attendees: string[]
  transcript: string | null
  transcript_summary: string | null
  extracted_action_items: {
    title: string
    description?: string
    company?: string | null
    assignee?: string
    urgency?: string
    suggested_due_date?: string | null
    related_item_ids?: string[]
  }[]
  extracted_decisions: { decision: string; context?: string }[]
  extracted_open_questions: { question: string; owner?: string }[]
  source: string | null
  processed_at: string | null
  created_at: string
  import_mode: MeetingImportMode
}

export function useMeetings() {
  const { user } = useAuth()

  useRealtimeSubscription({
    table: 'meetings',
    queryKey: ['meetings'],
  })

  return useQuery({
    queryKey: ['meetings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .order('start_time', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as Meeting[]
    },
    enabled: !!user,
  })
}

export function useMeeting(id: string) {
  return useQuery({
    queryKey: ['meetings', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data as Meeting
    },
    enabled: !!id,
  })
}

export function useCreateMeeting() {
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (payload: {
      title: string
      start_time?: string
      end_time?: string
      import_mode?: MeetingImportMode
      attendees?: string[]
    }) => {
      const { data, error } = await supabase
        .from('meetings')
        .insert({ ...payload, user_id: user!.id, source: 'manual' })
        .select()
        .single()
      if (error) throw error
      return data as Meeting
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] })
    },
  })
}

export function useUpdateMeeting() {
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string
      title?: string
      start_time?: string | null
      import_mode?: MeetingImportMode
    }) => {
      const { data, error } = await supabase
        .from('meetings')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Meeting
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] })
      queryClient.invalidateQueries({ queryKey: ['meetings', variables.id] })
    },
  })
}

export function useDeleteMeeting() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('meetings').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] })
    },
  })
}

export function useUploadTranscript() {
  return useMutation({
    mutationFn: async ({ meetingId, transcript }: { meetingId: string; transcript: string }) => {
      // Save transcript to meeting
      const { error: updateError } = await supabase
        .from('meetings')
        .update({ transcript, source: 'transcript_upload' })
        .eq('id', meetingId)

      if (updateError) throw updateError

      // Trigger AI parsing
      const userContext = formatUserContextBlock(buildUserContext())
      const { data, error } = await supabase.functions.invoke('ai-parse-transcript', {
        body: { meeting_id: meetingId, transcript, user_context: userContext },
      })

      if (error) {
        console.error('ai-parse-transcript error:', error)
        // FunctionsHttpError exposes the underlying Response in `context`.
        // Try to surface the function's actual error body so the UI can show it.
        const ctx = (error as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json()
            const detail = body?.detail ?? body?.error ?? JSON.stringify(body)
            throw new Error(detail)
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== 'Failed to fetch') {
              throw parseErr
            }
          }
        }
        throw error
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] })
    },
  })
}

export function useSyncCalendar() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('ics-sync')
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] })
    },
  })
}
