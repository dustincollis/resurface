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
