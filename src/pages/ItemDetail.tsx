import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Clock, Trash2 } from 'lucide-react'
import { useItem, useUpdateItem, useTouchItem, useDeleteItem } from '../hooks/useItems'
import { useActivityLog } from '../hooks/useActivityLog'
import InlineEditable from '../components/InlineEditable'
import type { ItemStatus } from '../lib/types'

const STATUS_OPTIONS: { value: ItemStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'done', label: 'Done' },
  { value: 'dropped', label: 'Dropped' },
]

function stalenessLabel(score: number): { text: string; className: string } {
  if (score < 20) return { text: 'fresh', className: 'bg-green-900/50 text-green-300' }
  if (score < 40) return { text: 'aging', className: 'bg-yellow-900/50 text-yellow-300' }
  if (score < 60) return { text: 'stale', className: 'bg-orange-900/50 text-orange-300' }
  return { text: 'critical', className: 'bg-red-900/50 text-red-300' }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDueDate(dateStr: string | null): { text: string; urgent: boolean } {
  if (!dateStr) return { text: '—', urgent: false }
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return { text: `${Math.abs(diffDays)}d overdue`, urgent: true }
  if (diffDays === 0) return { text: 'Today', urgent: true }
  if (diffDays === 1) return { text: 'Tomorrow', urgent: true }
  return { text: formatDate(dateStr), urgent: diffDays <= 3 }
}

function DotRating({
  value,
  max = 5,
  onChange,
  label,
}: {
  value: number | null
  max?: number
  onChange: (v: number) => void
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex gap-1">
        {Array.from({ length: max }, (_, i) => (
          <button
            key={i}
            onClick={() => onChange(i + 1)}
            className={`h-2.5 w-2.5 rounded-full transition-colors ${
              value && i < value ? 'bg-purple-400' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: item, isLoading } = useItem(id!)
  const updateItem = useUpdateItem()
  const touchItem = useTouchItem()
  const deleteItem = useDeleteItem()
  const { data: activities } = useActivityLog(id!)

  if (isLoading || !item) {
    return <div className="text-gray-400">Loading...</div>
  }

  const staleness = stalenessLabel(item.staleness_score)
  const due = formatDueDate(item.due_date)
  const streamColor = item.streams?.color ?? '#6B7280'

  const handleStatusChange = (status: ItemStatus) => {
    const completed_at = (status === 'done' || status === 'dropped')
      ? new Date().toISOString()
      : null
    updateItem.mutate({ id: item.id, status, completed_at })
  }

  const handleDelete = () => {
    deleteItem.mutate(item.id)
    navigate(-1)
  }

  // Custom fields from stream's field_templates
  const fieldTemplates = item.streams?.field_templates ?? []

  return (
    <div className="mx-auto max-w-3xl">
      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="mb-4 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"
      >
        <ArrowLeft size={16} /> Back
      </button>

      {/* Main card */}
      <div className="rounded-xl border border-gray-800 bg-gray-900">
        {/* Header */}
        <div className="border-b border-gray-800 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: streamColor }} />
              <span className="text-sm text-gray-400">
                {item.streams?.name ?? 'No stream'}
              </span>
              <span className="text-gray-600">/</span>
              <select
                value={item.status}
                onChange={(e) => handleStatusChange(e.target.value as ItemStatus)}
                className="rounded bg-transparent text-sm text-gray-300 outline-none hover:bg-gray-800"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-gray-900">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${staleness.className}`}>
              {staleness.text}
            </span>
          </div>

          {/* Title */}
          <div className="mt-3">
            <InlineEditable
              value={item.title}
              onSave={(title) => updateItem.mutate({ id: item.id, title })}
              as="h1"
              className="text-xl font-semibold text-white"
            />
          </div>

          {/* Description */}
          <div className="mt-2">
            <InlineEditable
              value={item.description}
              onSave={(description) => updateItem.mutate({ id: item.id, description })}
              as="p"
              className="text-sm text-gray-400"
              placeholder="Add a description..."
              multiline
            />
          </div>

          {/* Metadata row */}
          <div className="mt-4 flex gap-6 text-xs">
            <div>
              <span className="text-gray-500">Created</span>
              <div className="mt-0.5 text-gray-300">{formatDate(item.created_at)}</div>
            </div>
            <div>
              <span className="text-gray-500">Last touched</span>
              <div className="mt-0.5 text-gray-300">{formatDate(item.last_touched_at)}</div>
            </div>
            <div>
              <span className="text-gray-500">Due</span>
              <div className={`mt-0.5 ${due.urgent ? 'font-medium text-red-400' : 'text-gray-300'}`}>
                {due.text}
              </div>
            </div>
          </div>
        </div>

        {/* Next action */}
        <div className="border-b border-gray-800 px-6 py-4">
          <h3 className="mb-2 text-sm font-medium text-gray-300">Next action</h3>
          <InlineEditable
            value={item.next_action ?? ''}
            onSave={(next_action) => updateItem.mutate({ id: item.id, next_action })}
            className="text-sm text-gray-300"
            placeholder="What's the next step?"
          />
        </div>

        {/* Custom fields */}
        {fieldTemplates.length > 0 && (
          <div className="border-b border-gray-800 px-6 py-4">
            <h3 className="mb-3 text-sm font-medium text-gray-300">Fields</h3>
            <div className="grid grid-cols-2 gap-3">
              {fieldTemplates.map((tpl) => {
                const val = (item.custom_fields?.[tpl.key] as string) ?? ''
                return (
                  <div key={tpl.key}>
                    <label className="text-xs text-gray-500">{tpl.label}</label>
                    <input
                      type={tpl.type === 'number' ? 'number' : tpl.type === 'date' ? 'date' : 'text'}
                      value={val}
                      onChange={(e) => {
                        updateItem.mutate({
                          id: item.id,
                          custom_fields: { ...item.custom_fields, [tpl.key]: e.target.value },
                        })
                      }}
                      className="mt-0.5 block w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                      placeholder={tpl.label}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Due date */}
        <div className="border-b border-gray-800 px-6 py-4">
          <h3 className="mb-2 text-sm font-medium text-gray-300">Due date</h3>
          <input
            type="date"
            value={item.due_date ?? ''}
            onChange={(e) => updateItem.mutate({ id: item.id, due_date: e.target.value || null })}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white focus:border-purple-500 focus:outline-none"
          />
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-3 px-6 py-4">
          <button
            onClick={() => touchItem.mutate(item.id)}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-700 py-2 text-sm text-gray-300 hover:bg-gray-800"
          >
            <Clock size={14} /> Touch +1d
          </button>

          <DotRating
            value={item.resistance}
            onChange={(resistance) => updateItem.mutate({ id: item.id, resistance })}
            label="Resist"
          />

          <DotRating
            value={item.stakes}
            onChange={(stakes) => updateItem.mutate({ id: item.id, stakes })}
            label="Stakes"
          />

          <button
            onClick={() => handleStatusChange('done')}
            className="rounded-lg border border-green-800 px-3 py-2 text-sm text-green-400 hover:bg-green-900/30"
          >
            Complete
          </button>
          <button
            onClick={() => handleStatusChange('dropped')}
            className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-400 hover:bg-gray-800"
          >
            Drop
          </button>
          <button
            onClick={handleDelete}
            className="rounded-lg border border-gray-700 p-2 text-gray-500 hover:bg-gray-800 hover:text-red-400"
            title="Delete item"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Activity log */}
      {activities && activities.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-medium text-gray-400">Activity</h3>
          <div className="space-y-2">
            {activities.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 text-xs text-gray-500">
                <span className="w-24 flex-shrink-0">
                  {new Date(entry.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
                <span className="capitalize">{entry.action.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
