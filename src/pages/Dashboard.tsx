import { useItems } from '../hooks/useItems'
import ItemCard from '../components/ItemCard'
import QuickAddBar from '../components/QuickAddBar'

export default function Dashboard() {
  const { data: staleItems, isLoading: staleLoading } = useItems({
    status: ['open', 'in_progress', 'waiting'],
    sort_by: 'staleness_score',
    limit: 10,
  })

  const { data: allActiveItems } = useItems({
    status: ['open', 'in_progress', 'waiting'],
    sort_by: 'due_date',
    sort_ascending: true,
  })

  const { data: recentItems } = useItems({
    sort_by: 'last_touched_at',
    limit: 5,
  })

  // Filter items due within 7 days
  const now = new Date()
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const dueSoonItems = allActiveItems?.filter((item) => {
    if (!item.due_date) return false
    const due = new Date(item.due_date)
    return due <= weekFromNow
  }) ?? []

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold text-white">Dashboard</h1>

      <QuickAddBar />

      {/* Needs Attention */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-500">
          Needs Attention
        </h2>
        {staleLoading ? (
          <div className="text-sm text-gray-500">Loading...</div>
        ) : staleItems && staleItems.length > 0 ? (
          <div className="space-y-2">
            {staleItems.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-800 py-6 text-center text-sm text-gray-500">
            Nothing needs attention right now.
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
