import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Handshake,
  Quote,
  Calendar,
  AlertTriangle,
  Check,
  X,
  Pause,
  Trash2,
  ChevronRight,
  Plus,
  Loader2,
} from 'lucide-react'
import {
  useCommitments,
  useSetCommitmentStatus,
  useDeleteCommitment,
  useCreateCommitment,
} from '../hooks/useCommitments'
import type { Commitment, CommitmentStatus } from '../lib/types'

const STATUS_LABEL: Record<CommitmentStatus, string> = {
  open: 'Open',
  met: 'Met',
  broken: 'Broken',
  cancelled: 'Cancelled',
  waiting: 'Waiting',
}

const STATUS_STYLE: Record<CommitmentStatus, string> = {
  open: 'bg-amber-900/30 text-amber-300',
  met: 'bg-green-900/30 text-green-300',
  broken: 'bg-red-900/30 text-red-300',
  cancelled: 'bg-gray-800 text-gray-500',
  waiting: 'bg-blue-900/30 text-blue-300',
}

function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function CommitmentRow({ commitment }: { commitment: Commitment }) {
  const setStatus = useSetCommitmentStatus()
  const del = useDeleteCommitment()

  const isOverdue =
    commitment.status === 'open' &&
    commitment.do_by &&
    new Date(commitment.do_by + 'T23:59:59') < new Date()

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {commitment.company && (
              <span className="rounded bg-blue-600/20 px-2 py-0.5 text-xs font-semibold text-blue-300">
                {commitment.company}
              </span>
            )}
            {commitment.counterpart && (
              <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-xs text-amber-300">
                for {commitment.counterpart}
              </span>
            )}
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLE[commitment.status]}`}
            >
              {STATUS_LABEL[commitment.status]}
            </span>
          </div>
          <div className="mt-1.5 text-base font-semibold text-white">{commitment.title}</div>
          {commitment.description && (
            <div className="mt-0.5 text-xs text-gray-400">{commitment.description}</div>
          )}

          {/* Dates */}
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {commitment.do_by && (
              <span
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${
                  isOverdue ? 'bg-red-900/40 text-red-300' : 'bg-gray-800 text-gray-300'
                }`}
              >
                <Calendar size={11} />
                do by {formatDate(commitment.do_by)}
                {isOverdue && (
                  <span className="ml-1 inline-flex items-center gap-0.5">
                    <AlertTriangle size={10} />
                    overdue
                  </span>
                )}
              </span>
            )}
            {commitment.promised_by && commitment.promised_by !== commitment.do_by && (
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-400">
                promised by {formatDate(commitment.promised_by)}
              </span>
            )}
            {commitment.needs_review_by && (
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-400">
                review by {formatDate(commitment.needs_review_by)}
              </span>
            )}
          </div>

          {/* Evidence */}
          {commitment.evidence_text && (
            <div className="mt-2 flex gap-2 text-xs italic text-gray-500">
              <Quote size={12} className="mt-0.5 flex-shrink-0 text-gray-700" />
              <span>{commitment.evidence_text}</span>
            </div>
          )}

          {/* Source backlinks */}
          {(commitment.source_meeting_id || commitment.source_item_id) && (
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              {commitment.source_meeting_id && (
                <Link
                  to={`/meetings/${commitment.source_meeting_id}`}
                  className="flex items-center gap-1 text-purple-400 hover:text-purple-300"
                >
                  Source discussion
                  <ChevronRight size={10} />
                </Link>
              )}
              {commitment.source_item_id && (
                <Link
                  to={`/items/${commitment.source_item_id}`}
                  className="flex items-center gap-1 text-purple-400 hover:text-purple-300"
                >
                  Linked task
                  <ChevronRight size={10} />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Status actions — only when open or waiting */}
      {(commitment.status === 'open' || commitment.status === 'waiting') && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-gray-800 pt-2.5">
          <button
            onClick={() => setStatus(commitment.id, 'met')}
            className="flex items-center gap-1 rounded bg-green-600/20 px-2 py-1 text-[11px] font-medium text-green-300 hover:bg-green-600/30"
          >
            <Check size={11} />
            Met
          </button>
          {commitment.status !== 'waiting' && (
            <button
              onClick={() => setStatus(commitment.id, 'waiting')}
              className="flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-[11px] font-medium text-blue-300 hover:bg-gray-700"
            >
              <Pause size={11} />
              Waiting
            </button>
          )}
          {commitment.status === 'waiting' && (
            <button
              onClick={() => setStatus(commitment.id, 'open')}
              className="flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-[11px] font-medium text-amber-300 hover:bg-gray-700"
            >
              Resume
            </button>
          )}
          <button
            onClick={() => setStatus(commitment.id, 'broken')}
            className="flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-[11px] font-medium text-red-300 hover:bg-gray-700"
          >
            <X size={11} />
            Broken
          </button>
          <button
            onClick={() => setStatus(commitment.id, 'cancelled')}
            className="flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-[11px] font-medium text-gray-400 hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={() => del.mutate(commitment.id)}
            className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-[11px] text-gray-600 hover:text-red-400"
            title="Delete"
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
  )
}

export default function Commitments() {
  const { data: commitments, isLoading } = useCommitments()
  const createCommitment = useCreateCommitment()
  const [showForm, setShowForm] = useState(false)

  const grouped = useMemo(() => {
    const groups: Record<CommitmentStatus, Commitment[]> = {
      open: [],
      waiting: [],
      met: [],
      broken: [],
      cancelled: [],
    }
    for (const c of commitments ?? []) {
      groups[c.status].push(c)
    }
    return groups
  }, [commitments])

  const totalLive = grouped.open.length + grouped.waiting.length

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Commitments</h1>
          <p className="mt-1 text-sm text-gray-400">
            Soft obligations you've made — the things that don't fit as tasks but still need to land.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalLive > 0 && (
            <span className="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300">
              {totalLive} open
            </span>
          )}
          <button
            onClick={() => setShowForm((s) => !s)}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500"
          >
            <Plus size={14} />
            Add
          </button>
        </div>
      </div>

      {showForm && (
        <NewCommitmentForm
          onCancel={() => setShowForm(false)}
          onSaved={() => setShowForm(false)}
          createCommitment={createCommitment}
        />
      )}

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : !commitments || commitments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 px-6 py-16 text-center">
          <Handshake size={32} className="mx-auto text-gray-700" />
          <h2 className="mt-3 text-sm font-medium text-gray-400">No commitments yet</h2>
          <p className="mt-1 text-xs text-gray-600">
            Add one above, or AI will surface soft promises from transcripts.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.open.length > 0 && (
            <Section title="Open" items={grouped.open} />
          )}
          {grouped.waiting.length > 0 && (
            <Section title="Waiting" items={grouped.waiting} />
          )}
          {grouped.met.length > 0 && (
            <Section title="Met" items={grouped.met} dim />
          )}
          {grouped.broken.length > 0 && (
            <Section title="Broken" items={grouped.broken} dim />
          )}
          {grouped.cancelled.length > 0 && (
            <Section title="Cancelled" items={grouped.cancelled} dim />
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, items, dim = false }: { title: string; items: Commitment[]; dim?: boolean }) {
  return (
    <section className={dim ? 'opacity-60' : ''}>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
        {title} ({items.length})
      </h2>
      <div className="space-y-2">
        {items.map((c) => (
          <CommitmentRow key={c.id} commitment={c} />
        ))}
      </div>
    </section>
  )
}

interface NewCommitmentFormProps {
  onCancel: () => void
  onSaved: () => void
  createCommitment: ReturnType<typeof useCreateCommitment>
}

function NewCommitmentForm({ onCancel, onSaved, createCommitment }: NewCommitmentFormProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [counterpart, setCounterpart] = useState('')
  const [company, setCompany] = useState('')
  const [doBy, setDoBy] = useState('')
  const [promisedBy, setPromisedBy] = useState('')
  const [needsReviewBy, setNeedsReviewBy] = useState('')
  const [showExtraDates, setShowExtraDates] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    setError(null)
    try {
      await createCommitment.mutateAsync({
        title: title.trim(),
        description: description.trim() || null,
        counterpart: counterpart.trim() || null,
        company: company.trim() || null,
        do_by: doBy || null,
        promised_by: promisedBy || null,
        needs_review_by: needsReviewBy || null,
        status: 'open',
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="mb-6 space-y-3 rounded-xl border border-gray-700 bg-gray-900 p-4">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What did you commit to?"
        autoFocus
        className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Notes (optional)"
        rows={2}
        className="w-full resize-y rounded border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        <input
          value={counterpart}
          onChange={(e) => setCounterpart(e.target.value)}
          placeholder="For (counterpart)"
          className="flex-1 min-w-[160px] rounded border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
        />
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Company"
          className="flex-1 min-w-[160px] rounded border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] uppercase tracking-wider text-gray-500">Do by</label>
        <input
          type="date"
          value={doBy}
          onChange={(e) => setDoBy(e.target.value)}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
        />
        {!showExtraDates && (
          <button
            type="button"
            onClick={() => setShowExtraDates(true)}
            className="text-[11px] text-purple-400 hover:text-purple-300"
          >
            + add promised-by / review dates
          </button>
        )}
      </div>
      {showExtraDates && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[11px] uppercase tracking-wider text-gray-500">Promised by</label>
          <input
            type="date"
            value={promisedBy}
            onChange={(e) => setPromisedBy(e.target.value)}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
          />
          <label className="text-[11px] uppercase tracking-wider text-gray-500">Review by</label>
          <input
            type="date"
            value={needsReviewBy}
            onChange={(e) => setNeedsReviewBy(e.target.value)}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
          />
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={createCommitment.isPending || !title.trim()}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
        >
          {createCommitment.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Saving...
            </>
          ) : (
            'Add commitment'
          )}
        </button>
        <button
          onClick={onCancel}
          disabled={createCommitment.isPending}
          className="rounded-lg px-3 py-2 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && (
        <div className="rounded border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
    </div>
  )
}
