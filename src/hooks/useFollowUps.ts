import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import type {
  FollowUp,
  FollowUpRecipient,
  FollowUpStatus,
  FollowUpWithMeeting,
} from '../lib/types'

interface FollowUpFilters {
  status?: FollowUpStatus | FollowUpStatus[]
  source_meeting_id?: string
}

// Hydrate follow-ups with their source meeting (title + start_time) so the
// UI can label cards without an N+1 lookup.
async function hydrateMeetings(
  rows: FollowUp[],
): Promise<FollowUpWithMeeting[]> {
  if (rows.length === 0) return []
  const meetingIds = Array.from(new Set(rows.map((r) => r.source_meeting_id)))
  const { data: meetings } = await supabase
    .from('meetings')
    .select('id, title, start_time')
    .in('id', meetingIds)
  const byId = new Map<string, { id: string; title: string | null; start_time: string | null }>()
  for (const m of meetings ?? []) {
    byId.set(m.id, m as { id: string; title: string | null; start_time: string | null })
  }
  return rows.map((r) => ({ ...r, meeting: byId.get(r.source_meeting_id) ?? null }))
}

export function useFollowUps(filters?: FollowUpFilters) {
  const { user } = useAuth()

  useRealtimeSubscription({
    table: 'follow_ups',
    queryKey: ['follow_ups'],
  })

  return useQuery({
    queryKey: ['follow_ups', filters],
    queryFn: async () => {
      let query = supabase.from('follow_ups').select('*')

      if (filters?.status) {
        if (Array.isArray(filters.status)) {
          query = query.in('status', filters.status)
        } else {
          query = query.eq('status', filters.status)
        }
      } else {
        query = query.eq('status', 'pending')
      }

      if (filters?.source_meeting_id) {
        query = query.eq('source_meeting_id', filters.source_meeting_id)
      }

      const { data, error } = await query.order('created_at', { ascending: false })
      if (error) throw error
      const rows = (data ?? []) as FollowUp[]
      return await hydrateMeetings(rows)
    },
    enabled: !!user,
  })
}

// Convenience: follow-ups for a single meeting (any status). Used on the
// meeting detail page to show inline.
export function useFollowUpsByMeeting(meetingId: string | undefined) {
  const { user } = useAuth()

  useRealtimeSubscription({
    table: 'follow_ups',
    queryKey: ['follow_ups'],
  })

  return useQuery({
    queryKey: ['follow_ups', 'by_meeting', meetingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('follow_ups')
        .select('*')
        .eq('source_meeting_id', meetingId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as FollowUp[]
    },
    enabled: !!user && !!meetingId,
  })
}

function invalidateAll() {
  queryClient.invalidateQueries({ queryKey: ['follow_ups'] })
}

// Update arbitrary fields on a follow-up (e.g. user-edited recipients,
// notes, etc). Pass a partial; the row's own RLS scopes to the user.
export function useUpdateFollowUp() {
  return useMutation({
    mutationFn: async (args: { id: string; patch: Partial<FollowUp> }) => {
      const { error } = await supabase
        .from('follow_ups')
        .update(args.patch)
        .eq('id', args.id)
      if (error) throw error
    },
    onSuccess: invalidateAll,
  })
}

// Mark a single recipient as sent at the given timestamp. If every recipient
// in the row has sent_at populated after the change, the follow-up rolls up
// to status='sent' and gets a sent_at stamp on the row itself.
export function useMarkRecipientSent() {
  return useMutation({
    mutationFn: async (args: { id: string; recipientIndex: number }) => {
      const { data: existing, error: fetchErr } = await supabase
        .from('follow_ups')
        .select('id, status, recipients')
        .eq('id', args.id)
        .single()
      if (fetchErr) throw fetchErr

      const recipients = ((existing?.recipients ?? []) as FollowUpRecipient[]).map((r, i) =>
        i === args.recipientIndex ? { ...r, sent_at: new Date().toISOString() } : r,
      )
      const allSent = recipients.length > 0 && recipients.every((r) => !!r.sent_at)
      const patch: Partial<FollowUp> = {
        recipients,
        ...(allSent ? { status: 'sent', sent_at: new Date().toISOString() } : {}),
      }
      const { error } = await supabase
        .from('follow_ups')
        .update(patch)
        .eq('id', args.id)
      if (error) throw error
    },
    onSuccess: invalidateAll,
  })
}

export function useDismissFollowUp() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('follow_ups')
        .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidateAll,
  })
}

// "Send all" — stamps every un-sent recipient and rolls up to status='sent'.
// The frontend is still responsible for copying the per-recipient bodies to
// the clipboard; this just records the act.
export function useMarkAllSent() {
  return useMutation({
    mutationFn: async (id: string) => {
      const now = new Date().toISOString()
      const { data: existing, error: fetchErr } = await supabase
        .from('follow_ups')
        .select('id, recipients')
        .eq('id', id)
        .single()
      if (fetchErr) throw fetchErr
      const recipients = ((existing?.recipients ?? []) as FollowUpRecipient[]).map((r) => ({
        ...r,
        sent_at: r.sent_at ?? now,
      }))
      const { error } = await supabase
        .from('follow_ups')
        .update({ recipients, status: 'sent', sent_at: now })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidateAll,
  })
}
