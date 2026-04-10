import type { Item } from './types'

// Compare dates at noon local time so "due today" stays correct all day
// regardless of when the user looks. Avoids the off-by-one from
// new Date("2026-04-10") being midnight UTC while Date.now() is local.
function daysUntilDue(dueDateStr: string): number {
  const parts = dueDateStr.split('-').map(Number)
  const dueNoon = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0).getTime()
  const now = new Date()
  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0).getTime()
  return Math.round((dueNoon - todayNoon) / (1000 * 60 * 60 * 24))
}

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
    const days = daysUntilDue(item.due_date)
    if (days < 0) dueComponent = 100
    else if (days === 0) dueComponent = 90
    else if (days <= 3) dueComponent = 60
    else if (days <= 7) dueComponent = 30
  }
  dueComponent *= dueWeight

  return stalenessComponent + stakesComponent + resistanceComponent + dueComponent
}

// Effective staleness label that takes due date into account.
// An overdue item is always "critical" regardless of staleness_score.
// An item due within 24h is at least "stale".
export type StalenessLevel = 'fresh' | 'aging' | 'stale' | 'critical'

export function effectiveStalenessLevel(item: Item): StalenessLevel {
  // Pure staleness based on time since last touch — NOT conflated with
  // due-date urgency. Due-date signals are shown separately via
  // getSurfaceReasons ("Due today", "Due soon", "Nd overdue") and the
  // priority score. Mixing them here caused new items with upcoming
  // deadlines to show "Getting stale" immediately after creation.
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
    const days = daysUntilDue(item.due_date)
    if (days < 0) {
      reasons.push({ label: `${Math.abs(days)}d overdue`, tone: 'red' })
    } else if (days === 0) {
      reasons.push({ label: 'Due today', tone: 'orange' })
    } else if (days <= 3) {
      reasons.push({ label: 'Due soon', tone: 'orange' })
    }
  }

  // Staleness — the score is a composite of time + stakes + deadline urgency.
  // To show "Nd stale" we need to isolate the TIME component before inverse-
  // mapping, otherwise non-time factors inflate the day count absurdly (e.g.
  // a brand-new overdue item would show 241 days stale).
  const score = item.staleness_score ?? 0
  if (score >= 40) {
    const stakesContribution = (item.stakes ?? 3) * 5
    let deadlineContribution = 0
    if (item.due_date) {
      const hoursUntilDue = (new Date(item.due_date).getTime() - Date.now()) / (1000 * 60 * 60)
      if (hoursUntilDue < 0) deadlineContribution = 100
      else if (hoursUntilDue < 24) deadlineContribution = 50
      else if (hoursUntilDue < 72) deadlineContribution = 25
    }
    const timeOnlyScore = Math.max(0, score - stakesContribution - deadlineContribution)
    if (timeOnlyScore >= 40) {
      const hours = Math.pow(2, timeOnlyScore / 10) - 1
      const days = Math.round(hours / 24)
      if (days >= 1) reasons.push({ label: `${days}d stale`, tone: 'orange' })
      else reasons.push({ label: 'Stale', tone: 'orange' })
    } else if (timeOnlyScore >= 25) {
      reasons.push({ label: 'Getting stale', tone: 'yellow' })
    }
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
  const isOverdue = item.due_date && daysUntilDue(item.due_date) < 0

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
    const days = daysUntilDue(item.due_date)
    if (days < 0) dueRisk = 100
    else if (days === 0) dueRisk = 90
    else if (days <= 3) dueRisk = 70
    else if (days <= 7) dueRisk = 40
    else if (days <= 14) dueRisk = 20
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
      const d = daysUntilDue(item.due_date)
      if (d < 0) counts.overdue++
      else if (d <= 3) counts.dueSoon++
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

// Sort items by composite priority (descending). Pinned items always
// come first regardless of score. Use this everywhere items need to
// be ranked: dashboard, stream lists, etc.
export function sortByPriority(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return computePriority(b) - computePriority(a)
  })
}
