import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Person } from '../lib/types'

export function usePeople() {
  return useQuery({
    queryKey: ['people'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('people')
        .select('*, companies(*)')
        .order('name')
      if (error) throw error
      return data as Person[]
    },
  })
}

export function usePerson(id: string | undefined) {
  return useQuery({
    queryKey: ['people', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('people')
        .select('*, companies(*)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as Person
    },
  })
}

/** All meetings this person attended (via meeting_attendees junction) */
export function usePersonMeetings(personId: string | undefined) {
  return useQuery({
    queryKey: ['people', personId, 'meetings'],
    enabled: !!personId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meeting_attendees')
        .select('meeting_id, meetings(id, title, start_time, end_time, source)')
        .eq('person_id', personId!)
        .order('added_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r) => (r as unknown as { meetings: Record<string, unknown> }).meetings)
    },
  })
}

/** All commitments where this person is the counterpart */
export function usePersonCommitments(personId: string | undefined) {
  return useQuery({
    queryKey: ['people', personId, 'commitments'],
    enabled: !!personId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commitments')
        .select('*')
        .eq('person_id', personId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

export function useUpdatePerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<Omit<Person, 'id' | 'user_id' | 'created_at' | 'updated_at'>>) => {
      const { data, error } = await supabase
        .from('people')
        .update(updates)
        .eq('id', id)
        .select('*, companies(*)')
        .single()
      if (error) throw error
      return data as Person
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['people'] })
      qc.setQueryData(['people', data.id], data)
    },
  })
}

export function useMergePeople() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ keepId, mergeId }: { keepId: string; mergeId: string }) => {
      // Move all meeting_attendees from mergeId to keepId
      await supabase
        .from('meeting_attendees')
        .update({ person_id: keepId })
        .eq('person_id', mergeId)

      // Move all commitments
      await supabase
        .from('commitments')
        .update({ person_id: keepId })
        .eq('person_id', mergeId)

      // Delete the merged person
      const { error } = await supabase
        .from('people')
        .delete()
        .eq('id', mergeId)

      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['people'] })
      qc.invalidateQueries({ queryKey: ['commitments'] })
      qc.invalidateQueries({ queryKey: ['meetings'] })
    },
  })
}
