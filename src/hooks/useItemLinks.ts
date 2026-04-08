import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import type { ItemLink, LinkType } from '../lib/types'

export function useItemLinks(itemId: string) {
  return useQuery({
    queryKey: ['item_links', itemId],
    queryFn: async () => {
      // Fetch links where item is source
      const { data: asSource, error: err1 } = await supabase
        .from('item_links')
        .select('*, target_item:items!target_item_id(id, title, status)')
        .eq('source_item_id', itemId)

      if (err1) throw err1

      // Fetch links where item is target
      const { data: asTarget, error: err2 } = await supabase
        .from('item_links')
        .select('*, source_item:items!source_item_id(id, title, status)')
        .eq('target_item_id', itemId)

      if (err2) throw err2

      return [...(asSource ?? []), ...(asTarget ?? [])] as ItemLink[]
    },
    enabled: !!itemId,
  })
}

export function useCreateItemLink() {
  return useMutation({
    mutationFn: async (payload: {
      source_item_id: string
      target_item_id: string
      link_type: LinkType
    }) => {
      const { data, error } = await supabase
        .from('item_links')
        .insert(payload)
        .select()
        .single()
      if (error) throw error
      return data as ItemLink
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['item_links', variables.source_item_id] })
      queryClient.invalidateQueries({ queryKey: ['item_links', variables.target_item_id] })
    },
  })
}

export function useDeleteItemLink() {
  return useMutation({
    mutationFn: async ({ id, source_item_id, target_item_id }: {
      id: string
      source_item_id: string
      target_item_id: string
    }) => {
      const { error } = await supabase.from('item_links').delete().eq('id', id)
      if (error) throw error
      return { source_item_id, target_item_id }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['item_links', variables.source_item_id] })
      queryClient.invalidateQueries({ queryKey: ['item_links', variables.target_item_id] })
    },
  })
}
