import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Check, ChevronDown, ChevronUp, Sparkles, Play, Zap, Pin, AlarmClockOff, FolderTree } from 'lucide-react'
import { useItems, useTouchItem, useUpdateItem, useUnsnoozeItem } from '../hooks/useItems'
import { useStreams } from '../hooks/useStreams'
import { useEasyButton, type EasyButtonResult } from '../hooks/useEasyButton'
// ItemCard removed — focus mode uses compact FocusCards only
import QuickAddBar from '../components/QuickAddBar'
import OnboardingWizard from '../components/OnboardingWizard'
import EasyButtonModal from '../components/EasyButtonModal'
import {
  getSurfaceReasons,
  getSuggestedMove,
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
      className={`overflow-hidden rounded-lg border bg-gray-900 transition-colors ${
        expanded ? 'border-gray-700' : 'border-gray-800 hover:border-gray-700'
      } ${level === 'critical' ? 'ring-1 ring-red-900/30' : ''}`}
    >
      {/* Compact card */}
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
        className="w-full cursor-pointer px-5 py-4 text-left"
      >
        <div className="flex items-start gap-2.5">
          {item.pinned ? (
            <Pin size={12} className="mt-1 flex-shrink-0 text-yellow-400" />
          ) : rank > 0 ? (
            <span className="mt-1 flex-shrink-0 text-xs font-medium text-gray-600">
              {rank}
            </span>
          ) : (
            <span className="mt-1 w-3 flex-shrink-0" />
          )}

          <div className="min-w-0 flex-1">
            {/* Title */}
            <h3 className="text-base font-semibold leading-snug text-white line-clamp-2">
              {item.title}
            </h3>

            {/* Meta row: stream + company + due */}
            <div className="mt-1.5 flex items-center gap-2 text-xs">
              {item.streams && (
                <span className="flex items-center gap-1 text-gray-500">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: streamColor }} />
                  {item.streams.name}
                </span>
              )}
              {(item.custom_fields?.company as string | undefined) && (
                <span className="text-gray-600">{item.custom_fields.company as string}</span>
              )}
              {item.open_children_count && item.open_children_count > 0 ? (
                <span className="flex items-center gap-1 rounded-full border border-purple-900/40 bg-purple-950/30 px-1.5 py-0.5 text-[10px] text-purple-300">
                  <FolderTree size={9} />
                  {item.open_children_count} open task{item.open_children_count === 1 ? '' : 's'}
                </span>
              ) : null}
              {dueLabel && (
                <span className={
                  dueLabel.tone === 'red' ? 'font-medium text-red-400'
                    : dueLabel.tone === 'orange' ? 'font-medium text-orange-400'
                    : 'text-gray-500'
                }>
                  {dueLabel.text}
                </span>
              )}
            </div>

            {/* Next step */}
            {item.next_action && !expanded && (
              <p className="mt-1 line-clamp-1 text-xs text-gray-400">
                <span className="text-gray-600">Next:</span> {item.next_action}
              </p>
            )}
          </div>

          {/* Suggested action */}
          <button
            onClick={handleSuggestedAction}
            className={`flex-shrink-0 rounded px-2.5 py-1.5 text-xs font-semibold ${SUGGESTED_MOVE_STYLES[suggestedMove].className}`}
          >
            <SuggestedIcon size={12} />
          </button>
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="border-t border-gray-800/60 bg-gray-950/40 px-3 py-3">
          {item.description && (
            <p className="mb-2 text-xs text-gray-400 line-clamp-4">{item.description}</p>
          )}
          {item.next_action && (
            <p className="mb-2 text-xs text-gray-300">
              <span className="text-gray-500">Next:</span> {item.next_action}
            </p>
          )}
          {reasons.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {reasons.map((reason, i) => (
                <ReasonChip key={i} reason={reason} />
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/items/${item.id}`) }}
              className="flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-purple-500"
            >
              <Play size={10} /> Open
            </button>
            <button
              onClick={handleTouch}
              disabled={touchItem.isPending}
              className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
                touchedFlash
                  ? 'border-green-700 bg-green-900/30 text-green-300'
                  : 'border-gray-700 text-gray-300 hover:bg-gray-800'
              }`}
            >
              {touchedFlash ? <><Check size={10} /> Done</> : <><Clock size={10} /> Touch</>}
            </button>
            <button
              onClick={handleComplete}
              disabled={updateItem.isPending}
              className="flex items-center gap-1 rounded border border-green-800/60 bg-green-900/20 px-2 py-1 text-[11px] font-medium text-green-300 hover:bg-green-900/40 disabled:opacity-50"
            >
              <Check size={10} /> Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Focus() {
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
  const snoozedItems = useMemo(() => {
    if (!activeItems) return []
    return activeItems.filter(
      (item) =>
        !item.tracking &&
        !item.pinned &&
        item.snoozed_until &&
        new Date(item.snoozed_until) > new Date(now)
    )
  }, [activeItems, now])
  const snoozedCount = snoozedItems.length
  const [showAll, setShowAll] = useState(false)
  const [showSnoozed, setShowSnoozed] = useState(false)
  const unsnoozeItem = useUnsnoozeItem()

  // Remaining items (not in focus), sorted by due date (calendar order)
  const remainingByDate = useMemo(() => {
    const focusIds = new Set(focusItems.map((i) => i.id))
    const remaining = sortedActiveItems.filter((i) => !focusIds.has(i.id))
    return remaining.slice().sort((a, b) => {
      // Items with due dates come first, sorted ascending
      if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      if (a.due_date && !b.due_date) return -1
      if (!a.due_date && b.due_date) return 1
      // No due date: fall back to created_at ascending
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    })
  }, [sortedActiveItems, focusItems])

  if (!streamsLoading && streams && streams.length === 0 && !onboardingDismissed) {
    return <OnboardingWizard onComplete={() => setOnboardingDismissed(true)} />
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Top bar: count + actions */}
      <div className="mb-3 flex items-center gap-3">
        <span className="text-xs text-gray-500">
          {focusItems.length} of {sortedActiveItems.length} active
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleEasyButton}
            className="flex items-center gap-1.5 rounded-lg border border-yellow-700/50 bg-yellow-900/20 px-2.5 py-1 text-xs font-medium text-yellow-300 hover:bg-yellow-900/40"
          >
            <Zap size={12} />
            Easy Win
          </button>
          <QuickAddBar compact />
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : focusItems.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {focusItems.map((item, i) => (
              <FocusCard key={item.id} item={item} rank={i + 1} />
            ))}
          </div>
          {(hiddenCount > 0 || snoozedCount > 0) && (
            <div className="mt-3 text-center">
              {hiddenCount > 0 && (
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-400 hover:border-gray-600 hover:text-gray-300"
                >
                  {showAll ? (
                    <>
                      <ChevronUp size={12} />
                      Hide {hiddenCount} items
                    </>
                  ) : (
                    <>
                      <ChevronDown size={12} />
                      View all {hiddenCount} more by date
                    </>
                  )}
                </button>
              )}
              {snoozedCount > 0 && (
                <button
                  onClick={() => setShowSnoozed(!showSnoozed)}
                  className="mt-1 inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400"
                >
                  <AlarmClockOff size={11} />
                  {snoozedCount} snoozed {showSnoozed ? '(hide)' : '(show)'}
                </button>
              )}
            </div>
          )}
          {showSnoozed && snoozedItems.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500">
                  Snoozed
                </h3>
                <button
                  onClick={() => {
                    snoozedItems.forEach((item) => unsnoozeItem.mutate(item.id))
                    setShowSnoozed(false)
                  }}
                  className="text-xs text-purple-400 hover:text-purple-300"
                >
                  Unsnooze all
                </button>
              </div>
              <div className="space-y-1.5">
                {snoozedItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-sm text-gray-300">{item.title}</span>
                      {item.snoozed_until && (
                        <span className="ml-2 text-xs text-gray-600">
                          until {new Date(item.snoozed_until).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => unsnoozeItem.mutate(item.id)}
                      className="ml-2 flex-shrink-0 rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:border-gray-600 hover:text-gray-300"
                    >
                      Unsnooze
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {showAll && remainingByDate.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                All items by date
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {remainingByDate.map((item) => (
                  <FocusCard key={item.id} item={item} rank={0} />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-800 py-6 text-center text-sm text-gray-500">
          No tasks to focus on.
        </div>
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
