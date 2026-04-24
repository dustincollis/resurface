// FocusV2 ("Today v2") — an editorial alternative to the current Focus page.
// Same data and ranking (useItems + sortByPriority), different skin: vertical
// list of titles with one narrative chip per row. No stakes bars, no icon
// strip, no expand/collapse. Typography carries the weight; the right-side
// chip tells the one most relevant thing about each item.
//
// Chip factory is deterministic — no AI calls — so render is cheap. Higher-
// priority signals win: overdue > due-soon > stale > high-stakes > high-
// resistance > source-meeting > pinned > touched-recently.

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Plus, ArrowDown } from 'lucide-react'
import { useItems } from '../hooks/useItems'
import { useEasyButton, type EasyButtonResult } from '../hooks/useEasyButton'
import { sortByPriority } from '../lib/priorityScore'
import AddMenu from '../components/AddMenu'
import EasyButtonModal from '../components/EasyButtonModal'
import type { Item } from '../lib/types'

const FOCUS_LIMIT = 10

export default function FocusV2() {
  const navigate = useNavigate()
  const { data: activeItems, isLoading } = useItems({
    status: ['open', 'in_progress', 'waiting'],
    sort_by: 'staleness_score',
  })
  const easyButton = useEasyButton()
  const [easyOpen, setEasyOpen] = useState(false)
  const [easyResult, setEasyResult] = useState<EasyButtonResult | null>(null)
  const [showAll, setShowAll] = useState(false)

  const visibleActiveItems = useMemo(() => {
    if (!activeItems) return []
    const now = new Date()
    return activeItems.filter(
      (item) =>
        !item.tracking &&
        (item.pinned || !item.snoozed_until || new Date(item.snoozed_until) <= now)
    )
  }, [activeItems])

  const sorted = useMemo(() => sortByPriority(visibleActiveItems), [visibleActiveItems])

  const { focusItems, hiddenCount } = useMemo(() => {
    const pinned = sorted.filter((i) => i.pinned)
    const unpinned = sorted.filter((i) => !i.pinned)
    const remaining = Math.max(FOCUS_LIMIT - pinned.length, 0)
    const visible = [...pinned, ...unpinned.slice(0, remaining)]
    return { focusItems: visible, hiddenCount: sorted.length - visible.length }
  }, [sorted])

  const today = new Date()
  const headerDate = today
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase()

  const renderedItems = showAll ? sorted : focusItems

  return (
    <div className="mx-auto max-w-5xl">
      <Header
        date={headerDate}
        activeCount={focusItems.length}
        totalCap={FOCUS_LIMIT}
        hiddenCount={hiddenCount}
        onEasy={() => {
          setEasyResult(null)
          setEasyOpen(true)
          easyButton.mutate(undefined, {
            onSuccess: (data) => setEasyResult(data),
            onError: () => setEasyResult(null),
          })
        }}
      />

      {isLoading ? (
        <div className="mt-8 font-mono text-xs text-gray-500">Loading…</div>
      ) : renderedItems.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="mt-2 divide-y divide-gray-900">
          {renderedItems.map((item) => (
            <TaskRow key={item.id} item={item} onClick={() => navigate(`/items/${item.id}`)} />
          ))}
        </div>
      )}

      {!showAll && hiddenCount > 0 && (
        <div className="my-8 flex justify-center">
          <button
            onClick={() => setShowAll(true)}
            className="flex items-center gap-2 rounded border border-gray-800 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-gray-500 hover:border-gray-700 hover:text-gray-300"
          >
            <ArrowDown size={11} />
            View all {hiddenCount} more by date
          </button>
        </div>
      )}

      <EasyButtonModal
        isOpen={easyOpen}
        onClose={() => setEasyOpen(false)}
        result={easyResult}
        isLoading={easyButton.isPending}
        onRetry={() => {
          setEasyResult(null)
          easyButton.mutate(undefined, {
            onSuccess: (data) => setEasyResult(data),
            onError: () => setEasyResult(null),
          })
        }}
      />
    </div>
  )
}

function Header({
  date,
  activeCount,
  totalCap,
  hiddenCount,
  onEasy,
}: {
  date: string
  activeCount: number
  totalCap: number
  hiddenCount: number
  onEasy: () => void
}) {
  return (
    <div className="flex items-start justify-between pb-5">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-wider text-gray-500">
          Focus · {date}
        </div>
        <div className="mt-1 text-2xl font-semibold text-white">
          {activeCount} of {totalCap} active
          {hiddenCount > 0 && (
            <span className="ml-2 font-normal text-gray-500">
              · {hiddenCount} more by date
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onEasy}
          className="flex items-center gap-1.5 rounded border border-cyan-900/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-cyan-300 hover:bg-cyan-950/20"
        >
          <Sparkles size={12} />
          Easy Win
        </button>
        <AddMenu
          align="right"
          order="task"
          trigger={({ onClick, open }) => (
            <button
              onClick={onClick}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                open
                  ? 'bg-gray-200 text-gray-900'
                  : 'bg-white text-gray-900 hover:bg-gray-200'
              }`}
            >
              <Plus size={12} />
              Add Task
            </button>
          )}
        />
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="mt-12 rounded border border-dashed border-gray-800 px-6 py-16 text-center">
      <div className="font-mono text-[11px] uppercase tracking-wider text-gray-600">
        Nothing in focus
      </div>
      <p className="mt-2 text-sm text-gray-500">
        Add a task or let the parser surface work from your recent meetings.
      </p>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Row
// ----------------------------------------------------------------------------

function TaskRow({ item, onClick }: { item: Item; onClick: () => void }) {
  const stream = item.streams ?? null
  const streamColor = stream?.color ?? '#6B7280'
  const streamName = stream?.name ?? 'Uncategorized'
  const chip = buildChip(item)
  const dueLabel = formatDueLabel(item.due_date)

  return (
    <button
      onClick={onClick}
      className="group flex w-full items-start justify-between gap-4 px-1 py-5 text-left transition-colors hover:bg-gray-900/30"
    >
      <div className="min-w-0 flex-1">
        <div className="text-lg font-semibold leading-snug text-white group-hover:text-white">
          {item.title}
        </div>
        <div className="mt-1.5 flex items-center gap-3 font-mono text-[11px]">
          <span className="flex items-center gap-1.5 text-gray-300">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: streamColor }}
            />
            {streamName}
          </span>
          {dueLabel && (
            <>
              <span className="text-gray-700">·</span>
              <span className={dueLabel.className}>{dueLabel.text}</span>
            </>
          )}
        </div>
      </div>
      {chip && (
        <span
          className={`mt-1 flex-shrink-0 whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${chip.className}`}
        >
          {chip.label}
        </span>
      )}
    </button>
  )
}

// ----------------------------------------------------------------------------
// Date label (meta line)
// ----------------------------------------------------------------------------

function formatDueLabel(dateStr: string | null): { text: string; className: string } | null {
  if (!dateStr) return null
  const parts = dateStr.split('-').map(Number)
  const due = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0).getTime()
  const now = new Date()
  const todayNoon = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0
  ).getTime()
  const diffDays = Math.round((due - todayNoon) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return { text: `${Math.abs(diffDays)}d overdue`, className: 'text-red-400' }
  if (diffDays === 0) return { text: 'due today', className: 'text-cyan-300' }
  if (diffDays === 1) return { text: 'due tomorrow', className: 'text-cyan-300' }
  if (diffDays <= 7) return { text: `in ${diffDays}d`, className: 'text-gray-400' }
  if (diffDays <= 30) return { text: `in ${diffDays}d`, className: 'text-gray-500' }
  return { text: `in ${diffDays}d`, className: 'text-gray-600' }
}

// ----------------------------------------------------------------------------
// Narrative chip factory
// ----------------------------------------------------------------------------
//
// One chip per row. Picks the single most-relevant signal. Order matters —
// earlier conditions win. Label stays short enough to read in a glance.

interface Chip {
  label: string
  className: string
}

const CHIP_ALERT = 'border-red-700 text-red-300'
const CHIP_CYAN = 'border-cyan-800 text-cyan-300'
const CHIP_AMBER = 'border-amber-800/70 text-amber-300'
const CHIP_NEUTRAL = 'border-gray-700 text-gray-400'

function buildChip(item: Item): Chip | null {
  const now = new Date()

  // 1. Overdue always wins — the one alert color in the palette.
  if (item.due_date) {
    const parts = item.due_date.split('-').map(Number)
    const due = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0).getTime()
    const todayNoon = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0
    ).getTime()
    const diffDays = Math.round((due - todayNoon) / (1000 * 60 * 60 * 24))
    if (diffDays < 0) {
      return { label: 'Overdue', className: CHIP_ALERT }
    }
    if (diffDays === 0) return { label: 'Due Today', className: CHIP_CYAN }
  }

  // 2. Staleness in the real-neglect zone.
  const stakesContribution = (item.stakes ?? 3) * 5
  const timeOnly = Math.max(0, (item.staleness_score ?? 0) - stakesContribution)
  if (timeOnly >= 40) {
    const hours = Math.pow(2, timeOnly / 10) - 1
    const days = Math.round(hours / 24)
    if (days >= 1) return { label: `${days}d Stale`, className: CHIP_AMBER }
  }

  // 3. High-stakes, not yet overdue — the classic "watch this" chip.
  if ((item.stakes ?? 0) >= 4) {
    return { label: 'High Stakes', className: CHIP_CYAN }
  }

  // 4. Pinned items that didn't qualify for anything louder.
  if (item.pinned) {
    return { label: 'Pinned', className: CHIP_NEUTRAL }
  }

  // 5. Waiting status — useful context when nothing else is loud.
  if (item.status === 'waiting') {
    return { label: 'Waiting', className: CHIP_NEUTRAL }
  }

  return null
}

