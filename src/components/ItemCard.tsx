import { useNavigate } from 'react-router-dom'
import { Calendar } from 'lucide-react'
import StatusBadge from './StatusBadge'
import { effectiveStalenessLevel, stalenessFillClass } from '../lib/priorityScore'
import type { Item } from '../lib/types'

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`
  if (diffDays <= 7) return `${diffDays}d`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ItemCard({ item }: { item: Item }) {
  const navigate = useNavigate()
  const streamColor = item.streams?.color ?? '#6B7280'
  const isDue = item.due_date && new Date(item.due_date) <= new Date()
  const level = effectiveStalenessLevel(item)
  const fillWidth = Math.min(Math.max(item.staleness_score ?? 0, level === 'critical' ? 90 : level === 'stale' ? 60 : 0), 100)

  return (
    <button
      onClick={() => navigate(`/items/${item.id}`)}
      className="flex w-full items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 text-left transition-colors hover:border-gray-700"
    >
      <div
        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
        style={{ backgroundColor: streamColor }}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-white">{item.title}</span>
          {item.streams ? (
            <span
              className="flex-shrink-0 rounded px-1.5 py-0.5 text-xs"
              style={{
                backgroundColor: `${streamColor}20`,
                color: streamColor,
              }}
            >
              {item.streams.name}
            </span>
          ) : (
            <span className="flex-shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
              no stream
            </span>
          )}
        </div>
        {item.next_action && (
          <div className="mt-0.5 truncate text-xs text-gray-400">
            Next: {item.next_action}
          </div>
        )}
      </div>

      {item.due_date && (
        <div className={`flex items-center gap-1 text-xs ${isDue ? 'text-red-400' : 'text-gray-400'}`}>
          <Calendar size={12} />
          {formatDate(item.due_date)}
        </div>
      )}

      {/* Staleness heat bar */}
      <div
        className="h-1 w-10 flex-shrink-0 overflow-hidden rounded-full bg-gray-800"
        title={`Attention level: ${level}`}
      >
        <div
          className={`h-full rounded-full ${stalenessFillClass(item)} ${
            level === 'critical' ? 'animate-pulse' : ''
          }`}
          style={{ width: `${fillWidth}%` }}
        />
      </div>

      <StatusBadge status={item.status} />
    </button>
  )
}
