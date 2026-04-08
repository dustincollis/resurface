import { useMemo, useState } from 'react'
import { useItems } from '../hooks/useItems'
import { useStreams } from '../hooks/useStreams'
import ItemCard from '../components/ItemCard'
import QuickAddBar from '../components/QuickAddBar'
import OnboardingWizard from '../components/OnboardingWizard'
import { computePriority, priorityReason } from '../lib/priorityScore'
import type { Item } from '../lib/types'

function FocusCard({ item, rank }: { item: Item; rank: number }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-purple-900/50 text-xs font-medium text-purple-300">
        {rank}
      </span>
      <div className="flex-1">
        <ItemCard item={item} />
        <p className="mt-1 pl-1 text-xs text-gray-600">{priorityReason(item)}</p>
      </div>
    </div>
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

  // Today's Focus: top 5 by composite priority score
  const focusItems = useMemo(() => {
    if (!activeItems) return []
    return [...activeItems]
      .map((item) => ({ item, score: computePriority(item) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.item)
  }, [activeItems])

  // Due soon: within 7 days
  const dueSoonItems = useMemo(() => {
    if (!activeItems) return []
    const weekFromNow = new Date(now + 7 * 24 * 60 * 60 * 1000)
    return activeItems
      .filter((item) => item.due_date && new Date(item.due_date) <= weekFromNow)
      .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
  }, [activeItems, now])

  // Show onboarding if no streams exist
  if (!streamsLoading && streams && streams.length === 0 && !onboardingDismissed) {
    return <OnboardingWizard onComplete={() => setOnboardingDismissed(true)} />
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold text-white">Dashboard</h1>

      <QuickAddBar />

      {/* Today's Focus */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-500">
          Today&apos;s Focus
        </h2>
        {isLoading ? (
          <div className="text-sm text-gray-500">Loading...</div>
        ) : focusItems.length > 0 ? (
          <div className="space-y-3">
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
        <section className="mt-8">
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
        <section className="mt-8">
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
