import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface EntityMomentum {
  user_id?: string
  entity_type: 'person' | 'company'
  entity_id: string
  entity_name: string
  total_mentions: number
  weekly_counts: number[]
  refreshed_at?: string
}

function isNoiseEntity(entity: EntityMomentum) {
  if (entity.entity_type !== 'person') return false
  const name = entity.entity_name.trim().toLowerCase()
  return name === 'dustin collis' || /^speaker\s+\d+$/.test(name)
}

export function useEntityMomentum() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['utility', 'momentum'],
    queryFn: async () => {
      if (!user) return [] as EntityMomentum[]
      const { data, error } = await supabase
        .from('utility_entity_momentum')
        .select('*')
        .order('total_mentions', { ascending: false })
      if (error) throw new Error(error.message)
      return ((data ?? []) as EntityMomentum[]).filter((entity) => !isNoiseEntity(entity))
    },
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
  })
}
