import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Calendar } from 'lucide-react'
import { useItems } from '../hooks/useItems'
import { useStreams } from '../hooks/useStreams'
import ItemCard from '../components/ItemCard'
import StatusBadge from '../components/StatusBadge'
import QuickAddBar from '../components/QuickAddBar'
import OnboardingWizard from '../components/OnboardingWizard'
import { computePriority, priorityReason } from '../lib/priorityScore'
import type { Item } from '../lib/types'

function stalenessColor(score: number): string {
  if (score < 20) return 'bg-green-500'
  if (score < 40) return 'bg-yellow-500'
  if (score < 60) return 'bg-orange-500'
  return 'bg-red-500'
}

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`
  if (diffDays <= 7) return `${diffDays}d`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function FocusCard({ item, rank }: { item: Item; rank: number }) {
  const navigate = useNavigate()
  const streamColor = item.streams?.color ?? '#6B7280'
  const isDue = item.due_date && new Date(item.due_date) <= new Date()

  return (
    <button
      onClick={() => navigate(`/items/${item.id}`)}
      className="flex h-full flex-col rounded-xl border border-gray-800 bg-gray-900 p-4 text-left transition-colors hover:border-gray-700"
    >
      {/* Header: rank + stream */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-900/50 text-xs font-medium text-purple-300">
            {rank}
          </span>
          {item.streams ? (
            <span
              className="rounded px-1.5 py-0.5 text-xs"
              style={{
                backgroundColor: `${streamColor}20`,
                color: streamColor,
              }}
            >
              {item.streams.name}
            </span>
          ) : (
            <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-500">
              no stream
            </span>
          )}
        </div>
        <StatusBadge status={item.status} />
      </div>

      {/* Title (wraps) */}
      <h3 className="text-sm font-medium leading-snug text-white">
        {item.title}
      </h3>

      {/* Next action (wraps, up to 2 lines) */}
      {item.next_action && (
        <p className="mt-2 line-clamp-2 text-xs text-gray-500">
          Next: {item.next_action}
        </p>
      )}

      {/* Spacer to push footer down */}
      <div className="flex-1" />

      {/* Footer: due date + staleness + reason */}
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          {item.due_date ? (
            <span className={`flex items-center gap-1 text-xs ${isDue ? 'text-red-400' : 'text-gray-500'}`}>
              <Calendar size={11} />
              {formatDueDate(item.due_date)}
            </span>
          ) : (
            <span />
          )}
          <div className="h-1 w-12 overflow-hidden rounded-full bg-gray-800">
            <div
              className={`h-full rounded-full ${stalenessColor(item.staleness_score)} ${
                item.staleness_score >= 60 ? 'animate-pulse' : ''
              }`}
              style={{ width: `${Math.min(item.staleness_score, 100)}%` }}
            />
          </div>
        </div>
        <p className="text-xs italic text-gray-600">{priorityReason(item)}</p>
      </div>
    </button>
  )
}

export default function Dashboard() {
  const [now] = useState(() => Date.now())
  const { data: streams, isLoading: streamsLoading } = useStreams()
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)

  const { data: activeItems, isLoading } = useItems({
    status: ['open', 'in_progress', 'waiting'],
    sort_by: 'staleness_score',
  })

  const { data: recentItems } = useItems({
    sort_by: 'last_touched_at',
    limit: 5,
  })

  const focusItems = useMemo(() => {
    if (!activeItems) return []
    return [...activeItems]
      .map((item) => ({ item, score: computePriority(item) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item)
  }, [activeItems])

  const dueSoonItems = useMemo(() => {
    if (!activeItems) return []
    const weekFromNow = new Date(now + 7 * 24 * 60 * 60 * 1000)
    return activeItems
      .filter((item) => item.due_date && new Date(item.due_date) <= weekFromNow)
      .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
  }, [activeItems, now])

  if (!streamsLoading && streams && streams.length === 0 && !onboardingDismissed) {
    return <OnboardingWizard onComplete={() => setOnboardingDismissed(true)} />
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Today's Focus */}
      <section className="max-w-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-gray-500">
            Today&apos;s Focus
          </h2>
          <QuickAddBar compact />
        </div>
        {isLoading ? (
          <div className="text-sm text-gray-500">Loading...</div>
        ) : focusItems.length > 0 ? (
          <div className="space-y-3 overflow-y-auto">
            {focusItems.map((item, i) => (
              <FocusCard key={item.id} item={item} rank={i + 1} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-800 py-6 text-center text-sm text-gray-500">
            No items to focus on. Add some tasks to get started.
          </div>
        )}
      </section>

      {/* Due Soon */}
      {dueSoonItems.length > 0 && (
        <section className="mt-8 max-w-3xl">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-500">
            Due Soon
          </h2>
          <div className="space-y-2">
            {dueSoonItems.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* Recently Touched */}
      {recentItems && recentItems.length > 0 && (
        <section className="mt-8 max-w-3xl">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-500">
            Recently Touched
          </h2>
          <div className="space-y-2">
            {recentItems.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
