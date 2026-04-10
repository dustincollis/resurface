import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Check, ChevronDown, Sparkles, Play, Zap, Pin } from 'lucide-react'
import { useItems, useTouchItem, useUpdateItem } from '../hooks/useItems'
import { useStreams } from '../hooks/useStreams'
import { useEasyButton, type EasyButtonResult } from '../hooks/useEasyButton'
import ItemCard from '../components/ItemCard'
import QuickAddBar from '../components/QuickAddBar'
import OnboardingWizard from '../components/OnboardingWizard'
import EasyButtonModal from '../components/EasyButtonModal'
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

// All three suggested actions get the same visual weight — they're equally
// "suggestions" from the AI. Only the label and icon differentiate them.
const SUGGESTED_BUTTON_CLASS =
  'bg-purple-900/30 text-purple-200 border border-purple-800/60 hover:bg-purple-900/50'

const SUGGESTED_MOVE_STYLES: Record<SuggestedMove, { className: string; icon: typeof Play }> = {
  'Do Now': { className: SUGGESTED_BUTTON_CLASS, icon: Play },
  'Break Down': { className: SUGGESTED_BUTTON_CLASS, icon: Sparkles },
  'Open': { className: SUGGESTED_BUTTON_CLASS, icon: ChevronDown },
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
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded(!expanded)
          }
        }}
        className="w-full cursor-pointer px-4 py-3 text-left"
      >
        <div className="flex items-start gap-3">
          {item.pinned ? (
            <Pin
              size={14}
              className="mt-1 flex-shrink-0 text-yellow-400"
              aria-label="Pinned to focus"
            />
          ) : (
            <span className="mt-0.5 flex-shrink-0 text-sm font-medium text-gray-600">
              {rank}
            </span>
          )}

          <div className="min-w-0 flex-1">
            {/* Stream + company + due tag — kept subtle so the title dominates */}
            <div className="flex items-center gap-2 text-[11px]">
              {item.streams ? (
                <span className="flex items-center gap-1 text-gray-500">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: streamColor }}
                  />
                  {item.streams.name}
                </span>
              ) : (
                <span className="text-gray-600">No stream</span>
              )}
              {(item.custom_fields?.company as string | undefined) && (
                <>
                  <span className="text-gray-700">·</span>
                  <span className="text-gray-500">
                    {item.custom_fields.company as string}
                  </span>
                </>
              )}
              {dueLabel && (
                <>
                  <span className="text-gray-700">·</span>
                  <span
                    className={
                      dueLabel.tone === 'red'
                        ? 'font-medium text-red-400'
                        : dueLabel.tone === 'orange'
                        ? 'font-medium text-orange-400'
                        : 'text-gray-500'
                    }
                  >
                    {dueLabel.text}
                  </span>
                </>
              )}
            </div>

            {/* Title — the most prominent element */}
            <h3 className="mt-1 text-lg font-semibold leading-snug text-white">
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
                title="The very next physical step to make progress on this task. Editable on the task detail page."
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
                  ? 'Open this task and act on it'
                  : suggestedMove === 'Break Down'
                  ? 'Open this task to break it into sub-tasks'
                  : 'Open task details'
              }
            >
              <SuggestedIcon size={12} />
              {suggestedMove}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="border-t border-gray-800/60 bg-gray-950/40 px-4 py-4">
          {/* Action row */}
          <div className="mb-4 grid grid-cols-3 gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/items/${item.id}`) }}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-500"
              title="Open task details and act on it"
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
                  <Clock size={12} /> {new Date().getDay() === 5 ? 'Touch → Mon' : 'Touch +1d'}
                </>
              )}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/items/${item.id}`) }}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 hover:bg-gray-800"
              title="Open task details to break it down"
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
              title="Mark this task as done"
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
  const easyButton = useEasyButton()
  const [easyResult, setEasyResult] = useState<EasyButtonResult | null>(null)
  const [easyOpen, setEasyOpen] = useState(false)

  const handleEasyButton = () => {
    setEasyResult(null)
    setEasyOpen(true)
    easyButton.mutate(undefined, {
      onSuccess: (data) => {
        setEasyResult(data)
      },
      onError: () => {
        setEasyResult(null)
      },
    })
  }

  const { data: activeItems, isLoading } = useItems({
    status: ['open', 'in_progress', 'waiting'],
    sort_by: 'staleness_score',
  })

  const { data: recentItems } = useItems({
    sort_by: 'last_touched_at',
    limit: 5,
  })

  const FOCUS_LIMIT = 10
  // Filter out snoozed and tracking-only items.
  // Tracked items live on pursuit pages, not the dashboard.
  // Pinned items always show, regardless of snooze.
  const visibleActiveItems = useMemo(() => {
    if (!activeItems) return []
    return activeItems.filter(
      (item) =>
        !item.tracking &&
        (item.pinned ||
          !item.snoozed_until ||
          new Date(item.snoozed_until) <= new Date(now))
    )
  }, [activeItems, now])
  const sortedActiveItems = useMemo(
    () => sortByPriority(visibleActiveItems),
    [visibleActiveItems]
  )
  // Always include pinned items + top FOCUS_LIMIT by priority
  const focusItems = useMemo(() => {
    const pinned = sortedActiveItems.filter((item) => item.pinned)
    const unpinned = sortedActiveItems.filter((item) => !item.pinned)
    const remainingSlots = Math.max(FOCUS_LIMIT - pinned.length, 0)
    return [...pinned, ...unpinned.slice(0, remainingSlots)]
  }, [sortedActiveItems])
  const hiddenCount = sortedActiveItems.length - focusItems.length
  const snoozedCount = (activeItems?.length ?? 0) - visibleActiveItems.length
  const clusterFactors = useMemo(() => getClusterFactors(focusItems), [focusItems])

  const dueSoonItems = useMemo(() => {
    if (!visibleActiveItems) return []
    const weekFromNow = new Date(now + 7 * 24 * 60 * 60 * 1000)
    return visibleActiveItems
      .filter((item) => item.due_date && new Date(item.due_date) <= weekFromNow)
      .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
  }, [visibleActiveItems, now])

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
          <div className="flex items-center gap-2">
            <button
              onClick={handleEasyButton}
              className="flex items-center gap-1.5 rounded-lg border border-yellow-700/50 bg-yellow-900/20 px-3 py-1.5 text-xs font-medium text-yellow-300 hover:bg-yellow-900/40"
              title="Pick a low-effort task to knock out quickly"
            >
              <Zap size={14} />
              Easy Win
            </button>
            <QuickAddBar compact />
          </div>
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
            {(hiddenCount > 0 || snoozedCount > 0) && (
              <p className="mt-3 text-center text-xs text-gray-600">
                {hiddenCount > 0 && (
                  <>+ {hiddenCount} more active task{hiddenCount !== 1 ? 's' : ''} not shown</>
                )}
                {hiddenCount > 0 && snoozedCount > 0 && <> · </>}
                {snoozedCount > 0 && (
                  <>{snoozedCount} snoozed for later</>
                )}
              </p>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-800 py-6 text-center text-sm text-gray-500">
            No tasks to focus on. Add one to get started.
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

      <EasyButtonModal
        isOpen={easyOpen}
        onClose={() => setEasyOpen(false)}
        result={easyResult}
        isLoading={easyButton.isPending}
        onRetry={handleEasyButton}
      />
    </div>
  )
}
