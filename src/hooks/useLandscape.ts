import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import type {
  Item,
  Commitment,
  Pursuit,
  Goal,
  PursuitMember,
  GoalTask,
} from '../lib/types'

export interface LandscapeData {
  items: Item[]
  commitments: Commitment[]
  pursuits: Pursuit[]
  goals: Goal[]
  pursuitMembers: PursuitMember[]
  goalTasks: GoalTask[]
}

// Single query bundle for the Landscape page: everything needed to render
// the item/commitment canvas plus pursuit hulls and goal territories.
export function useLandscape() {
  const { user } = useAuth()

  useRealtimeSubscription({ table: 'items', queryKey: ['landscape'] })
  useRealtimeSubscription({ table: 'commitments', queryKey: ['landscape'] })
  useRealtimeSubscription({ table: 'pursuits', queryKey: ['landscape'] })
  useRealtimeSubscription({ table: 'goals', queryKey: ['landscape'] })
  useRealtimeSubscription({ table: 'pursuit_members', queryKey: ['landscape'] })

  return useQuery({
    queryKey: ['landscape'],
    queryFn: async (): Promise<LandscapeData> => {
      const [
        itemsRes,
        commitsRes,
        pursuitsRes,
        goalsRes,
        memberRes,
        goalTasksRes,
      ] = await Promise.all([
        supabase
          .from('items')
          .select('*, streams(*)')
          .in('status', ['open', 'in_progress', 'waiting'])
          .eq('tracking', false),
        supabase
          .from('commitments')
          .select('*')
          .in('status', ['open', 'waiting']),
        supabase.from('pursuits').select('*').eq('status', 'active'),
        supabase.from('goals').select('*').eq('status', 'active'),
        supabase.from('pursuit_members').select('*'),
        supabase.from('goal_tasks').select('*').not('linked_entity_id', 'is', null),
      ])
      if (itemsRes.error) throw itemsRes.error
      if (commitsRes.error) throw commitsRes.error
      if (pursuitsRes.error) throw pursuitsRes.error
      if (goalsRes.error) throw goalsRes.error
      if (memberRes.error) throw memberRes.error
      if (goalTasksRes.error) throw goalTasksRes.error

      return {
        items: itemsRes.data as Item[],
        commitments: commitsRes.data as Commitment[],
        pursuits: pursuitsRes.data as Pursuit[],
        goals: goalsRes.data as Goal[],
        pursuitMembers: memberRes.data as PursuitMember[],
        goalTasks: goalTasksRes.data as GoalTask[],
      }
    },
    enabled: !!user,
  })
}
