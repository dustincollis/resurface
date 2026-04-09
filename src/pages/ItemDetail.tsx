import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Clock, Trash2, Plus, ArrowRight, Pencil, Link as LinkIcon, Calendar, GitBranch, Check, Pin, PinOff, Handshake } from 'lucide-react'
import { useItem, useUpdateItem, useTouchItem, useDeleteItem, useTogglePin } from '../hooks/useItems'
import { useStreams } from '../hooks/useStreams'
import { useActivityLog } from '../hooks/useActivityLog'
import InlineEditable from '../components/InlineEditable'
import ItemLinkSection from '../components/ItemLinkSection'
import { useCommitmentsByItem } from '../hooks/useCommitments'
import DecomposeSection from '../components/DecomposeSection'
import { effectiveStalenessLevel, stalenessPillClass } from '../lib/priorityScore'
import type { ItemStatus } from '../lib/types'

const STATUS_OPTIONS: { value: ItemStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'done', label: 'Done' },
  { value: 'dropped', label: 'Dropped' },
]


function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
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
      <span className="text-xs font-medium text-gray-300">{label}</span>
      <div className="flex gap-1.5">
        {Array.from({ length: max }, (_, i) => (
          <button
            key={i}
            onClick={() => onChange(i + 1)}
            title={`${label}: ${i + 1} of ${max}`}
            className={`h-4 w-4 rounded-full ring-1 ring-gray-700 transition-all hover:scale-110 hover:ring-purple-400 ${
              value && i < value ? 'bg-purple-500' : 'bg-gray-800 hover:bg-gray-700'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

const ACTIVITY_ICONS: Record<string, { icon: typeof Plus; color: string }> = {
  created: { icon: Plus, color: 'text-green-500' },
  status_changed: { icon: ArrowRight, color: 'text-blue-400' },
  field_updated: { icon: Pencil, color: 'text-gray-400' },
  touched: { icon: Clock, color: 'text-purple-400' },
  linked: { icon: LinkIcon, color: 'text-gray-400' },
}

function activityLabel(action: string, details: Record<string, unknown>): string {
  switch (action) {
    case 'created':
      return 'Created'
    case 'status_changed': {
      const fields = details.fields as string[] | undefined
      if (fields?.includes('status')) return 'Status changed'
      return 'Updated'
    }
    case 'field_updated': {
      const fields = details.fields as string[] | undefined
      if (fields && fields.length > 0) return `Updated ${fields.join(', ')}`
      return 'Updated'
    }
    case 'touched':
      return 'Touched'
    default:
      return action.replace(/_/g, ' ')
  }
}

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: item, isLoading } = useItem(id!)
  const { data: streams } = useStreams()
  const updateItem = useUpdateItem()
  const touchItem = useTouchItem()
  const deleteItem = useDeleteItem()
  const togglePin = useTogglePin()
  const { data: activities } = useActivityLog(id!)
  const { data: itemCommitments } = useCommitmentsByItem(id!)
  const [touchedFlash, setTouchedFlash] = useState(false)

  const handleTouch = () => {
    if (!item) return
    touchItem.mutate(item.id, {
      onSuccess: () => {
        setTouchedFlash(true)
        setTimeout(() => setTouchedFlash(false), 1500)
      },
    })
  }

  if (isLoading || !item) {
    return <div className="text-gray-400">Loading...</div>
  }

  const stalenessLevel = effectiveStalenessLevel(item)
  const stalenessClass = stalenessPillClass(item)
  const due = formatDueDate(item.due_date)
  const streamColor = item.streams?.color ?? '#6B7280'
  const sourceMeeting = (item as { source_meeting?: { id: string; title: string } | null }).source_meeting
  const parent = (item as { parent?: { id: string; title: string } | null }).parent

  const handleStatusChange = (status: ItemStatus, navigateAway = false) => {
    const completed_at = (status === 'done' || status === 'dropped')
      ? new Date().toISOString()
      : null
    updateItem.mutate(
      { id: item.id, status, completed_at },
      {
        onSuccess: () => {
          if (navigateAway) {
            navigate(-1)
          }
        },
        onError: (err) => {
          console.error('Failed to update status:', err)
          alert('Failed to update task. Check console for details.')
        },
      }
    )
  }

  const handleDelete = () => {
    deleteItem.mutate(item.id)
    navigate(-1)
  }

  const fieldTemplates = item.streams?.field_templates ?? []

  return (
    <div className="mx-auto max-w-3xl">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div className="rounded-xl border border-gray-800 bg-gray-900">
        {/* Header */}
        <div className="border-b border-gray-800 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: streamColor }} />
              <select
                value={item.stream_id ?? ''}
                onChange={(e) => updateItem.mutate({ id: item.id, stream_id: e.target.value || null })}
                className="rounded bg-transparent text-sm text-gray-300 outline-none hover:bg-gray-800"
              >
                <option value="" className="bg-gray-900">No stream</option>
                {streams?.map((s) => (
                  <option key={s.id} value={s.id} className="bg-gray-900">
                    {s.name}
                  </option>
                ))}
              </select>
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
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${stalenessClass}`}
              title={
                stalenessLevel === 'critical'
                  ? 'Needs immediate attention'
                  : stalenessLevel === 'stale'
                  ? 'Getting stale — review soon'
                  : stalenessLevel === 'aging'
                  ? 'Cooling down'
                  : 'Recently touched'
              }
            >
              {stalenessLevel}
            </span>
          </div>

          <div className="mt-4 flex items-start gap-2">
            {item.pinned && (
              <Pin size={18} className="mt-1 flex-shrink-0 text-yellow-400" aria-label="Pinned to focus" />
            )}
            <div className="flex-1">
              <InlineEditable
                value={item.title}
                onSave={(title) => updateItem.mutate({ id: item.id, title })}
                as="h1"
                className="text-2xl font-bold leading-tight text-white"
              />
            </div>
          </div>

          <div className="mt-3">
            <InlineEditable
              value={item.description}
              onSave={(description) => updateItem.mutate({ id: item.id, description })}
              as="p"
              className="text-sm leading-relaxed text-gray-400"
              placeholder="Add a description..."
              multiline
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-xs">
            <div>
              <span className="text-gray-400">Company</span>
              <div className="mt-0.5">
                <InlineEditable
                  value={(item.custom_fields?.company as string | undefined) ?? ''}
                  onSave={(company) => {
                    const newCustomFields = { ...(item.custom_fields ?? {}) }
                    if (company.trim()) {
                      newCustomFields.company = company.trim()
                    } else {
                      delete newCustomFields.company
                    }
                    updateItem.mutate({ id: item.id, custom_fields: newCustomFields })
                  }}
                  placeholder="add company..."
                  className={
                    item.custom_fields?.company
                      ? 'rounded bg-blue-900/40 px-1.5 py-0.5 font-semibold text-blue-300'
                      : 'text-gray-500 italic'
                  }
                />
              </div>
            </div>
            <div>
              <span className="text-gray-400">Created</span>
              <div className="mt-0.5 text-gray-200">{formatDate(item.created_at)}</div>
            </div>
            <div>
              <span className="text-gray-400">Last touched</span>
              <div className="mt-0.5 text-gray-200">{formatDate(item.last_touched_at)}</div>
            </div>
            <div>
              <span className="text-gray-400">Due</span>
              <div className={`mt-0.5 ${due.urgent ? 'font-semibold text-red-400' : 'text-gray-200'}`}>
                {due.text}
              </div>
            </div>
            {sourceMeeting && (
              <div>
                <span className="text-gray-400">From discussion</span>
                <button
                  onClick={() => navigate(`/meetings/${sourceMeeting.id}`)}
                  className="mt-0.5 flex items-center gap-1 text-purple-400 hover:text-purple-300"
                >
                  <Calendar size={11} />
                  {sourceMeeting.title}
                </button>
              </div>
            )}
            {parent && (
              <div>
                <span className="text-gray-400">Parent</span>
                <button
                  onClick={() => navigate(`/items/${parent.id}`)}
                  className="mt-0.5 flex items-center gap-1 text-purple-400 hover:text-purple-300"
                >
                  <GitBranch size={11} />
                  {parent.title}
                </button>
              </div>
            )}
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

        {/* Sub-items / decompose */}
        <DecomposeSection item={item} />

        {/* Linked items */}
        <ItemLinkSection itemId={item.id} />

        {/* Commitments tied to this item */}
        {itemCommitments && itemCommitments.length > 0 && (
          <div className="border-b border-gray-800 px-6 py-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-300">
              <Handshake size={14} />
              Commitments ({itemCommitments.length})
            </h3>
            <div className="space-y-1.5">
              {itemCommitments.map((c) => (
                <Link
                  key={c.id}
                  to="/commitments"
                  className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/50 px-3 py-2 text-xs hover:border-gray-700 hover:bg-gray-900"
                >
                  <span className="flex-1 truncate text-gray-200">{c.title}</span>
                  {c.counterpart && (
                    <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-300">
                      for {c.counterpart}
                    </span>
                  )}
                  <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gray-400">
                    {c.status}
                  </span>
                </Link>
              ))}
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

        {/* Sentiment ratings (separate section, not in action bar) */}
        <div className="border-b border-gray-800 px-6 py-4">
          <h3 className="mb-3 text-sm font-medium text-gray-300">How does this feel?</h3>
          <div className="flex items-center gap-8">
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
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Resist: how much you dread doing this. Stakes: cost of letting it slip.
          </p>
        </div>

        {/* Action bar — Complete is the dominant action */}
        <div className="px-6 py-4">
          <button
            onClick={() => handleStatusChange('done', true)}
            disabled={updateItem.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-purple-500 disabled:opacity-50"
            title="Mark this task as done and return"
          >
            <Check size={14} /> {updateItem.isPending ? 'Saving...' : 'Mark Complete'}
          </button>

          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => togglePin.mutate({ id: item.id, pinned: !item.pinned })}
              disabled={togglePin.isPending}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-xs transition-colors disabled:opacity-50 ${
                item.pinned
                  ? 'border-yellow-700 bg-yellow-900/30 text-yellow-300 hover:bg-yellow-900/50'
                  : 'border-gray-700 text-gray-300 hover:bg-gray-800'
              }`}
              title={
                item.pinned
                  ? "Remove from Today's Focus"
                  : "Pin to Today's Focus regardless of priority score"
              }
            >
              {item.pinned ? (
                <>
                  <PinOff size={12} /> Unpin from Focus
                </>
              ) : (
                <>
                  <Pin size={12} /> Pin to Focus
                </>
              )}
            </button>
            <button
              onClick={handleTouch}
              disabled={touchItem.isPending}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-xs transition-colors disabled:opacity-50 ${
                touchedFlash
                  ? 'border-green-700 bg-green-900/30 text-green-300'
                  : 'border-gray-700 text-gray-300 hover:bg-gray-800'
              }`}
              title="Bump 'last touched' to now so it stops getting stale"
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
              onClick={() => handleStatusChange('dropped', true)}
              disabled={updateItem.isPending}
              className="flex flex-1 items-center justify-center rounded-lg border border-gray-700 py-2 text-xs text-gray-400 hover:bg-gray-800 disabled:opacity-50"
              title="Mark as not pursuing — won't appear in active lists"
            >
              Drop
            </button>
            <button
              onClick={handleDelete}
              className="rounded-lg border border-gray-700 p-2 text-gray-500 hover:bg-gray-800 hover:text-red-400"
              title="Delete task permanently"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Activity log */}
      {activities && activities.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-medium text-gray-400">Activity</h3>
          <div className="relative border-l border-gray-800 pl-4">
            {activities.map((entry) => {
              const config = ACTIVITY_ICONS[entry.action] ?? { icon: Clock, color: 'text-gray-500' }
              const Icon = config.icon
              return (
                <div key={entry.id} className="relative mb-3 flex items-start gap-3">
                  <div className={`absolute -left-[1.28rem] mt-0.5 rounded-full bg-gray-950 p-0.5 ${config.color}`}>
                    <Icon size={12} />
                  </div>
                  <div className="flex-1">
                    <span className="text-xs text-gray-300">
                      {activityLabel(entry.action, entry.details)}
                    </span>
                    <span className="ml-2 text-xs text-gray-600">
                      {new Date(entry.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
