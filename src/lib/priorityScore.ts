import type { Item } from './types'

export function computePriority(item: Item): number {
  const stalenessWeight = 0.4
  const stakesWeight = 0.3
  const resistanceWeight = 0.1
  const dueWeight = 0.2

  // Staleness: already 0-100+ scale
  const stalenessComponent = Math.min(item.staleness_score, 100) * stalenessWeight

  // Stakes: 1-5 mapped to 0-100
  const stakesComponent = ((item.stakes ?? 3) / 5) * 100 * stakesWeight

  // Resistance inverse: lower resistance = higher priority (easier to start)
  const resistanceComponent = ((6 - (item.resistance ?? 3)) / 5) * 100 * resistanceWeight

  // Due date urgency
  let dueComponent = 0
  if (item.due_date) {
    const daysUntilDue = (new Date(item.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    if (daysUntilDue < 0) dueComponent = 100
    else if (daysUntilDue < 1) dueComponent = 90
    else if (daysUntilDue < 3) dueComponent = 60
    else if (daysUntilDue < 7) dueComponent = 30
  }
  dueComponent *= dueWeight

  return stalenessComponent + stakesComponent + resistanceComponent + dueComponent
}

// Effective staleness label that takes due date into account.
// An overdue item is always "critical" regardless of staleness_score.
// An item due within 24h is at least "stale".
export type StalenessLevel = 'fresh' | 'aging' | 'stale' | 'critical'

export function effectiveStalenessLevel(item: Item): StalenessLevel {
  if (item.due_date) {
    const ms = new Date(item.due_date).getTime() - Date.now()
    const hoursUntil = ms / (1000 * 60 * 60)
    if (hoursUntil < 0) return 'critical'
    if (hoursUntil < 24) return 'critical'
    if (hoursUntil < 72) return 'stale'
  }
  const score = item.staleness_score ?? 0
  if (score < 20) return 'fresh'
  if (score < 40) return 'aging'
  if (score < 60) return 'stale'
  return 'critical'
}

const STALENESS_BG: Record<StalenessLevel, string> = {
  fresh: 'bg-green-500',
  aging: 'bg-yellow-500',
  stale: 'bg-orange-500',
  critical: 'bg-red-500',
}

const STALENESS_PILL: Record<StalenessLevel, string> = {
  fresh: 'bg-green-900/50 text-green-300',
  aging: 'bg-yellow-900/50 text-yellow-300',
  stale: 'bg-orange-900/50 text-orange-300',
  critical: 'bg-red-900/50 text-red-300',
}

export function stalenessFillClass(item: Item): string {
  return STALENESS_BG[effectiveStalenessLevel(item)]
}

export function stalenessPillClass(item: Item): string {
  return STALENESS_PILL[effectiveStalenessLevel(item)]
}

export function priorityReason(item: Item): string {
  const reasons: string[] = []

  if (item.staleness_score >= 40) reasons.push('getting stale')
  if ((item.stakes ?? 0) >= 4) reasons.push('high stakes')
  if (item.due_date) {
    const daysUntilDue = (new Date(item.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    if (daysUntilDue < 0) reasons.push('overdue')
    else if (daysUntilDue < 3) reasons.push('due soon')
  }
  if ((item.resistance ?? 3) <= 2) reasons.push('low resistance')

  return reasons.length > 0 ? reasons.join(', ') : 'balanced priority'
}
