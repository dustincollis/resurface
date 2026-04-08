import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'

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
  extracted_action_items: { title: string; description?: string; assignee?: string; urgency?: string; related_item_ids?: string[] }[]
  extracted_decisions: { decision: string; context?: string }[]
  extracted_open_questions: { question: string; owner?: string }[]
  source: string | null
  processed_at: string | null
  created_at: string
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
    mutationFn: async (payload: { title: string; start_time?: string; end_time?: string }) => {
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

export function useUploadTranscript() {
  return useMutation({
    mutationFn: async ({ meetingId, transcript }: { meetingId: string; transcript: string }) => {
      // Save transcript to meeting
      await supabase
        .from('meetings')
        .update({ transcript, source: 'transcript_upload' })
        .eq('id', meetingId)

      // Trigger AI parsing
      const { data, error } = await supabase.functions.invoke('ai-parse-transcript', {
        body: { meeting_id: meetingId, transcript },
      })

      if (error) throw error
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
