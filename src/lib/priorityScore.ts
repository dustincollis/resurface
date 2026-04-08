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

// Generate small chip-friendly reasons explaining why an item surfaced
// to the focus list. These are concrete and visible to the user.
export interface SurfaceReason {
  label: string
  tone: 'red' | 'orange' | 'yellow' | 'blue' | 'gray'
}

export function getSurfaceReasons(item: Item): SurfaceReason[] {
  const reasons: SurfaceReason[] = []

  // Due date signals (highest priority)
  if (item.due_date) {
    const daysUntilDue = Math.floor(
      (new Date(item.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    )
    if (daysUntilDue < 0) {
      reasons.push({ label: `${Math.abs(daysUntilDue)}d overdue`, tone: 'red' })
    } else if (daysUntilDue === 0) {
      reasons.push({ label: 'Due today', tone: 'orange' })
    } else if (daysUntilDue <= 3) {
      reasons.push({ label: 'Due soon', tone: 'orange' })
    }
  }

  // Staleness
  const score = item.staleness_score ?? 0
  if (score >= 60) {
    // Convert score to approximate days using inverse of base_decay = log2(hours+1)*10
    const hours = Math.pow(2, score / 10) - 1
    const days = Math.round(hours / 24)
    if (days >= 1) reasons.push({ label: `${days}d stale`, tone: 'orange' })
    else reasons.push({ label: 'Stale', tone: 'orange' })
  } else if (score >= 40) {
    reasons.push({ label: 'Getting stale', tone: 'yellow' })
  }

  // Stakes
  if ((item.stakes ?? 0) >= 4) {
    reasons.push({ label: 'High stakes', tone: 'red' })
  }

  // Resistance
  if ((item.resistance ?? 0) >= 4) {
    reasons.push({ label: 'High resistance', tone: 'yellow' })
  }

  // Status as a hint
  if (item.status === 'waiting') {
    reasons.push({ label: 'Waiting', tone: 'blue' })
  }

  return reasons
}

// What action should we suggest? Returns the action name + a description.
// Touch is intentionally never suggested — it's a maintenance action.
export type SuggestedMove = 'Do Now' | 'Break Down' | 'Open'

export function getSuggestedMove(item: Item): SuggestedMove {
  const stakes = item.stakes ?? 0
  const resistance = item.resistance ?? 0
  const isOverdue = item.due_date && new Date(item.due_date) < new Date()

  // High resistance + high stakes → break it down so it's actionable
  if (resistance >= 4 && stakes >= 3) return 'Break Down'

  // Overdue with a clear next action → do it now
  if (isOverdue && item.next_action) return 'Do Now'

  // High stakes with a clear next action → do it now
  if (stakes >= 4 && item.next_action) return 'Do Now'

  // Default: open and decide
  return 'Open'
}

// Score breakdown for the expanded view: 4 components, 0-100 each
export interface ScoreBreakdown {
  staleness: number
  stakes: number
  resistance: number
  due_risk: number
}

export function getScoreBreakdown(item: Item): ScoreBreakdown {
  const staleness = Math.round(Math.min(item.staleness_score ?? 0, 100))
  const stakes = Math.round(((item.stakes ?? 3) / 5) * 100)
  // Higher resistance = harder to start. Show as-is, not inverted.
  const resistance = Math.round(((item.resistance ?? 3) / 5) * 100)

  let dueRisk = 0
  if (item.due_date) {
    const daysUntilDue = (new Date(item.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    if (daysUntilDue < 0) dueRisk = 100
    else if (daysUntilDue < 1) dueRisk = 90
    else if (daysUntilDue < 3) dueRisk = 70
    else if (daysUntilDue < 7) dueRisk = 40
    else if (daysUntilDue < 14) dueRisk = 20
  }

  return { staleness, stakes, resistance, due_risk: dueRisk }
}

// Aggregate dominant factors across a list of items, for cluster chips
export interface ClusterFactor {
  label: string
  count: number
}

export function getClusterFactors(items: Item[]): ClusterFactor[] {
  const counts = {
    overdue: 0,
    stale: 0,
    highStakes: 0,
    highResistance: 0,
    dueSoon: 0,
  }

  for (const item of items) {
    if (item.due_date) {
      const days = (new Date(item.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      if (days < 0) counts.overdue++
      else if (days <= 3) counts.dueSoon++
    }
    if ((item.staleness_score ?? 0) >= 60) counts.stale++
    if ((item.stakes ?? 0) >= 4) counts.highStakes++
    if ((item.resistance ?? 0) >= 4) counts.highResistance++
  }

  const factors: ClusterFactor[] = []
  if (counts.overdue > 0) factors.push({ label: `${counts.overdue} overdue`, count: counts.overdue })
  if (counts.dueSoon > 0) factors.push({ label: `${counts.dueSoon} due soon`, count: counts.dueSoon })
  if (counts.stale > 0) factors.push({ label: `${counts.stale} stale`, count: counts.stale })
  if (counts.highStakes > 0) factors.push({ label: `${counts.highStakes} high stakes`, count: counts.highStakes })
  if (counts.highResistance > 0) factors.push({ label: `${counts.highResistance} blocked`, count: counts.highResistance })

  // Top 3 by count
  return factors.sort((a, b) => b.count - a.count).slice(0, 3)
}

// Sort items by composite priority (descending). Use this everywhere
// items need to be ranked: dashboard, stream lists, etc.
export function sortByPriority(items: Item[]): Item[] {
  return [...items].sort((a, b) => computePriority(b) - computePriority(a))
}
