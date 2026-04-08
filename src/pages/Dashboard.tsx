import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Check, ChevronDown, Sparkles, Play } from 'lucide-react'
import { useItems, useTouchItem, useUpdateItem } from '../hooks/useItems'
import { useStreams } from '../hooks/useStreams'
import ItemCard from '../components/ItemCard'
import QuickAddBar from '../components/QuickAddBar'
import OnboardingWizard from '../components/OnboardingWizard'
import {
  getSurfaceReasons,
  getSuggestedMove,
  getClusterFactors,
  sortByPriority,
  effectiveStalenessLevel,
  type SurfaceReason,
  type SuggestedMove,
} from '../lib/priorityScore'
import type { Item } from '../lib/types'

const TONE_CLASSES: Record<SurfaceReason['tone'], string> = {
  red: 'bg-red-900/40 text-red-300 border-red-900/60',
  orange: 'bg-orange-900/40 text-orange-300 border-orange-900/60',
  yellow: 'bg-yellow-900/40 text-yellow-300 border-yellow-900/60',
  blue: 'bg-blue-900/40 text-blue-300 border-blue-900/60',
  gray: 'bg-gray-800 text-gray-400 border-gray-700',
}

function ReasonChip({ reason }: { reason: SurfaceReason }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASSES[reason.tone]}`}>
      {reason.label}
    </span>
  )
}

function formatDueLabel(dateStr: string): { text: string; tone: 'red' | 'orange' | 'gray' } {
  const date = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return { text: `${Math.abs(diffDays)}d overdue`, tone: 'red' }
  if (diffDays === 0) return { text: 'Due today', tone: 'orange' }
  if (diffDays === 1) return { text: 'Due tomorrow', tone: 'orange' }
  if (diffDays <= 7) return { text: `Due in ${diffDays}d`, tone: 'gray' }
  return { text: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), tone: 'gray' }
}

const SUGGESTED_MOVE_STYLES: Record<SuggestedMove, { className: string; icon: typeof Play }> = {
  'Do Now': { className: 'bg-purple-600 text-white hover:bg-purple-500', icon: Play },
  'Break Down': { className: 'bg-purple-900/40 text-purple-200 border border-purple-800/50 hover:bg-purple-900/60', icon: Sparkles },
  'Open': { className: 'bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700', icon: ChevronDown },
}

function FocusCard({ item, rank }: { item: Item; rank: number }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [touchedFlash, setTouchedFlash] = useState(false)
  const touchItem = useTouchItem()
  const updateItem = useUpdateItem()

  const reasons = getSurfaceReasons(item)
  const suggestedMove = getSuggestedMove(item)
  const dueLabel = item.due_date ? formatDueLabel(item.due_date) : null
  const streamColor = item.streams?.color ?? '#6B7280'
  const level = effectiveStalenessLevel(item)
  const SuggestedIcon = SUGGESTED_MOVE_STYLES[suggestedMove].icon

  const handleSuggestedAction = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (suggestedMove === 'Do Now' || suggestedMove === 'Open') {
      navigate(`/items/${item.id}`)
    } else if (suggestedMove === 'Break Down') {
      navigate(`/items/${item.id}`)
    }
  }

  const handleTouch = (e: React.MouseEvent) => {
    e.stopPropagation()
    touchItem.mutate(item.id, {
      onSuccess: () => {
        setTouchedFlash(true)
        setTimeout(() => setTouchedFlash(false), 1500)
      },
    })
  }

  const handleComplete = (e: React.MouseEvent) => {
    e.stopPropagation()
    updateItem.mutate({
      id: item.id,
      status: 'done',
      completed_at: new Date().toISOString(),
    })
  }

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-gray-900 transition-colors ${
        expanded ? 'border-gray-700' : 'border-gray-800 hover:border-gray-700'
      } ${level === 'critical' ? 'ring-1 ring-red-900/30' : ''}`}
    >
      {/* Always-visible row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 text-left"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex-shrink-0 text-sm font-medium text-gray-600">
            {rank}
          </span>

          <div className="min-w-0 flex-1">
            {/* Stream + due tag */}
            <div className="flex items-center gap-2 text-[11px]">
              {item.streams ? (
                <span
                  className="rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide"
                  style={{
                    backgroundColor: `${streamColor}20`,
                    color: streamColor,
                  }}
                >
                  {item.streams.name}
                </span>
              ) : (
                <span className="rounded bg-gray-800 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-gray-500">
                  No stream
                </span>
              )}
              {dueLabel && (
                <span
                  className={`font-medium ${
                    dueLabel.tone === 'red'
                      ? 'text-red-400'
                      : dueLabel.tone === 'orange'
                      ? 'text-orange-400'
                      : 'text-gray-500'
                  }`}
                >
                  {dueLabel.text}
                </span>
              )}
            </div>

            {/* Title */}
            <h3 className="mt-1 text-base font-semibold leading-snug text-white">
              {item.title}
            </h3>

            {/* Notes (description) — shown collapsed too */}
            {item.description && (
              <p className={`mt-1 text-xs text-gray-400 ${expanded ? 'line-clamp-5' : 'line-clamp-2'}`}>
                {item.description}
              </p>
            )}

            {/* Next step */}
            {item.next_action && (
              <p
                className="mt-1.5 line-clamp-1 text-xs text-gray-300"
                title="The very next physical step to make progress on this item. Editable on the item detail page."
              >
                <span className="text-gray-500">Next step:</span> {item.next_action}
              </p>
            )}

            {/* Reason chips */}
            {reasons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {reasons.map((reason, i) => (
                  <ReasonChip key={i} reason={reason} />
                ))}
              </div>
            )}
          </div>

          {/* Right rail: suggested action only */}
          <div className="flex-shrink-0">
            <button
              onClick={handleSuggestedAction}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${SUGGESTED_MOVE_STYLES[suggestedMove].className}`}
              title={
                suggestedMove === 'Do Now'
                  ? 'Open this item and act on it'
                  : suggestedMove === 'Break Down'
                  ? 'Open this item to break it into sub-tasks'
                  : 'Open item details'
              }
            >
              <SuggestedIcon size={12} />
              {suggestedMove}
            </button>
          </div>
        </div>
      </button>

      {/* Expanded section */}
      {expanded && (
        <div className="border-t border-gray-800/60 bg-gray-950/40 px-4 py-4">
          {/* Action row */}
          <div className="mb-4 grid grid-cols-3 gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/items/${item.id}`) }}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-500"
              title="Open item details and act on it"
            >
              <Play size={12} /> Do Now
            </button>
            <button
              onClick={handleTouch}
              disabled={touchItem.isPending}
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                touchedFlash
                  ? 'border-green-700 bg-green-900/30 text-green-300'
                  : 'border-gray-700 text-gray-300 hover:bg-gray-800'
              }`}
              title="Bump 'last touched' to now"
            >
              {touchedFlash ? (
                <>
                  <Check size={12} /> Touched!
                </>
              ) : (
                <>
                  <Clock size={12} /> Touch +1d
                </>
              )}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/items/${item.id}`) }}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 hover:bg-gray-800"
              title="Open item details to break it down"
            >
              <Sparkles size={12} /> Break Down
            </button>
          </div>

          {/* Bottom row: Mark Complete on the right (Open lives in top-right corner) */}
          <div className="flex items-center justify-end">
            <button
              onClick={handleComplete}
              disabled={updateItem.isPending}
              className="flex items-center gap-1.5 rounded-lg border border-green-800/60 bg-green-900/20 px-3 py-1.5 text-xs font-medium text-green-300 hover:bg-green-900/40 disabled:opacity-50"
              title="Mark this item as done"
            >
              <Check size={12} /> Mark Complete
            </button>
          </div>
        </div>
      )}
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

  const FOCUS_LIMIT = 10
  const sortedActiveItems = useMemo(
    () => (activeItems ? sortByPriority(activeItems) : []),
    [activeItems]
  )
  const focusItems = useMemo(
    () => sortedActiveItems.slice(0, FOCUS_LIMIT),
    [sortedActiveItems]
  )
  const hiddenCount = sortedActiveItems.length - focusItems.length
  const clusterFactors = useMemo(() => getClusterFactors(focusItems), [focusItems])

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
    <div className="mx-auto max-w-2xl">
      {/* Today's Focus */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="flex items-baseline gap-2">
              <h2 className="text-xl font-bold text-white">Today&apos;s Focus</h2>
              {focusItems.length > 0 && (
                <span className="text-xs text-gray-500">
                  {focusItems.length} of {sortedActiveItems.length} active
                </span>
              )}
            </div>
            {clusterFactors.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {clusterFactors.map((factor, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-gray-800 px-2 py-0.5 text-[11px] text-gray-400"
                  >
                    {factor.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <QuickAddBar compact />
        </div>
        {isLoading ? (
          <div className="text-sm text-gray-500">Loading...</div>
        ) : focusItems.length > 0 ? (
          <>
            <div className="space-y-3">
              {focusItems.map((item, i) => (
                <FocusCard key={item.id} item={item} rank={i + 1} />
              ))}
            </div>
            {hiddenCount > 0 && (
              <p className="mt-3 text-center text-xs text-gray-600">
                + {hiddenCount} more active item{hiddenCount !== 1 ? 's' : ''} not shown. Open a stream to see all.
              </p>
            )}
          </>
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
