import { useNavigate } from 'react-router-dom'
import { Calendar } from 'lucide-react'
import StatusBadge from './StatusBadge'
import type { Item } from '../lib/types'

function stalenessColor(score: number): string {
  if (score < 20) return 'bg-green-500'
  if (score < 40) return 'bg-yellow-500'
  if (score < 60) return 'bg-orange-500'
  return 'bg-red-500'
}

function stalenessLabel(score: number): string {
  if (score < 20) return 'fresh'
  if (score < 40) return 'aging'
  if (score < 60) return 'stale'
  return 'critical'
}

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
        <div className="truncate text-sm font-medium text-white">{item.title}</div>
        {item.next_action && (
          <div className="mt-0.5 truncate text-xs text-gray-500">
            Next: {item.next_action}
          </div>
        )}
      </div>

      {item.due_date && (
        <div className={`flex items-center gap-1 text-xs ${isDue ? 'text-red-400' : 'text-gray-500'}`}>
          <Calendar size={12} />
          {formatDate(item.due_date)}
        </div>
      )}

      {/* Staleness heat bar */}
      <div
        className="h-1 w-10 flex-shrink-0 overflow-hidden rounded-full bg-gray-800"
        title={`Staleness: ${item.staleness_score.toFixed(0)} (${stalenessLabel(item.staleness_score)})`}
      >
        <div
          className={`h-full rounded-full ${stalenessColor(item.staleness_score)} ${
            item.staleness_score >= 60 ? 'animate-pulse' : ''
          }`}
          style={{ width: `${Math.min(item.staleness_score, 100)}%` }}
        />
      </div>

      <StatusBadge status={item.status} />
    </button>
  )
}
