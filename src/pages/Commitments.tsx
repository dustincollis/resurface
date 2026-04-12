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
  ArrowUpRight,
  ArrowDownLeft,
} from 'lucide-react'
import {
  useCommitments,
  useSetCommitmentStatus,
  useUpdateCommitment,
  useDeleteCommitment,
  useCreateCommitment,
} from '../hooks/useCommitments'
import AddToPursuit from '../components/AddToPursuit'
import type { Commitment, CommitmentStatus, CommitmentDirection } from '../lib/types'

const STATUS_LABEL: Record<CommitmentStatus, string> = {
  open: 'Open',
  met: 'Met',
  broken: 'Broken',
  cancelled: 'Cancelled',
  waiting: 'Waiting',
  historical: 'Historical',
}

const STATUS_STYLE: Record<CommitmentStatus, string> = {
  open: 'bg-amber-900/30 text-amber-300',
  met: 'bg-green-900/30 text-green-300',
  broken: 'bg-red-900/30 text-red-300',
  cancelled: 'bg-gray-800 text-gray-500',
  waiting: 'bg-blue-900/30 text-blue-300',
  historical: 'bg-gray-800/50 text-gray-400',
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
  const updateCommitment = useUpdateCommitment()
  const del = useDeleteCommitment()
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editCounterpart, setEditCounterpart] = useState('')
  const [editCompany, setEditCompany] = useState('')
  const [editDoBy, setEditDoBy] = useState('')
  const [editPromisedBy, setEditPromisedBy] = useState('')
  const [editReviewBy, setEditReviewBy] = useState('')

  const startEdit = () => {
    setEditTitle(commitment.title)
    setEditDescription(commitment.description ?? '')
    setEditCounterpart(commitment.counterpart ?? '')
    setEditCompany(commitment.company ?? '')
    setEditDoBy(commitment.do_by ?? '')
    setEditPromisedBy(commitment.promised_by ?? '')
    setEditReviewBy(commitment.needs_review_by ?? '')
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!editTitle.trim()) return
    await updateCommitment.mutateAsync({
      id: commitment.id,
      title: editTitle.trim(),
      description: editDescription.trim() || null,
      counterpart: editCounterpart.trim() || null,
      company: editCompany.trim() || null,
      do_by: editDoBy || null,
      promised_by: editPromisedBy || null,
      needs_review_by: editReviewBy || null,
    })
    setEditing(false)
  }

  const isOverdue =
    commitment.status === 'open' &&
    commitment.do_by &&
    new Date(commitment.do_by + 'T23:59:59') < new Date()

  if (editing) {
    return (
      <div className="rounded-xl border border-purple-800/40 bg-gray-900 px-4 py-3 space-y-2">
        <input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
          autoFocus
        />
        <textarea
          value={editDescription}
          onChange={(e) => setEditDescription(e.target.value)}
          placeholder="Notes"
          rows={2}
          className="w-full resize-y rounded border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
        />
        <div className="flex gap-2">
          <input
            value={editCounterpart}
            onChange={(e) => setEditCounterpart(e.target.value)}
            placeholder="Counterpart"
            className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />
          <input
            value={editCompany}
            onChange={(e) => setEditCompany(e.target.value)}
            placeholder="Company"
            className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="text-[10px] uppercase tracking-wider text-gray-500">Do by</label>
          <input type="date" value={editDoBy} onChange={(e) => setEditDoBy(e.target.value)}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white focus:border-purple-500 focus:outline-none" />
          <label className="text-[10px] uppercase tracking-wider text-gray-500">Promised</label>
          <input type="date" value={editPromisedBy} onChange={(e) => setEditPromisedBy(e.target.value)}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white focus:border-purple-500 focus:outline-none" />
          <label className="text-[10px] uppercase tracking-wider text-gray-500">Review</label>
          <input type="date" value={editReviewBy} onChange={(e) => setEditReviewBy(e.target.value)}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white focus:border-purple-500 focus:outline-none" />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={saveEdit} disabled={updateCommitment.isPending || !editTitle.trim()}
            className="flex items-center gap-1 rounded bg-purple-600 px-3 py-1.5 text-xs text-white hover:bg-purple-500 disabled:opacity-50">
            {updateCommitment.isPending ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save
          </button>
          <button onClick={() => setEditing(false)} className="rounded px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200">
            Cancel
          </button>
        </div>
      </div>
    )
  }

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
              <span
                className={`rounded px-1.5 py-0.5 text-xs ${
                  commitment.direction === 'incoming'
                    ? 'bg-blue-900/30 text-blue-300'
                    : 'bg-amber-900/30 text-amber-300'
                }`}
              >
                {commitment.direction === 'incoming' ? 'from' : 'for'} {commitment.counterpart}
              </span>
            )}
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLE[commitment.status]}`}
            >
              {STATUS_LABEL[commitment.status]}
            </span>
          </div>
          <button onClick={startEdit} className="mt-1.5 text-left text-base font-semibold text-white hover:text-purple-300" title="Click to edit">
            {commitment.title}
          </button>
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
          <div className="ml-auto flex items-center gap-1.5">
            <AddToPursuit memberType="commitment" memberId={commitment.id} variant="compact" />
            <button
              onClick={() => del.mutate(commitment.id)}
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-gray-600 hover:text-red-400"
              title="Delete"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Commitments() {
  const { data: commitments, isLoading } = useCommitments()
  const createCommitment = useCreateCommitment()
  const [showForm, setShowForm] = useState(false)

  // Split by direction first, then group by status within each.
  const { outgoing, incoming, hasIncoming } = useMemo(() => {
    const outgoingGroups: Record<CommitmentStatus, Commitment[]> = {
      open: [], waiting: [], met: [], broken: [], cancelled: [], historical: [],
    }
    const incomingGroups: Record<CommitmentStatus, Commitment[]> = {
      open: [], waiting: [], met: [], broken: [], cancelled: [], historical: [],
    }
    let anyIncoming = false
    for (const c of commitments ?? []) {
      if (c.direction === 'incoming') {
        incomingGroups[c.status].push(c)
        anyIncoming = true
      } else {
        outgoingGroups[c.status].push(c)
      }
    }
    return { outgoing: outgoingGroups, incoming: incomingGroups, hasIncoming: anyIncoming }
  }, [commitments])

  const totalLive =
    outgoing.open.length + outgoing.waiting.length +
    incoming.open.length + incoming.waiting.length

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
        <div className="space-y-8">
          {/* You owe — outgoing commitments */}
          <DirectionGroup
            heading="You owe"
            icon={<ArrowUpRight size={14} className="text-amber-400" />}
            groups={outgoing}
            showHeading={hasIncoming}
          />

          {/* Owed to you — incoming commitments. Hidden when empty so the
              page looks identical to before for outgoing-only users. */}
          {hasIncoming && (
            <DirectionGroup
              heading="Owed to you"
              icon={<ArrowDownLeft size={14} className="text-blue-400" />}
              groups={incoming}
              showHeading
            />
          )}
        </div>
      )}
    </div>
  )
}

function DirectionGroup({
  heading,
  icon,
  groups,
  showHeading,
}: {
  heading: string
  icon: React.ReactNode
  groups: Record<CommitmentStatus, Commitment[]>
  showHeading: boolean
}) {
  const total = groups.open.length + groups.waiting.length + groups.met.length + groups.broken.length + groups.cancelled.length
  if (total === 0) return null
  return (
    <div className="space-y-4">
      {showHeading && (
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          {icon}
          {heading}
        </h2>
      )}
      {groups.open.length > 0 && <Section title="Open" items={groups.open} />}
      {groups.waiting.length > 0 && <Section title="Waiting" items={groups.waiting} />}
      {groups.met.length > 0 && <Section title="Met" items={groups.met} dim />}
      {groups.broken.length > 0 && <Section title="Broken" items={groups.broken} dim />}
      {groups.cancelled.length > 0 && <Section title="Cancelled" items={groups.cancelled} dim />}
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
  const [direction, setDirection] = useState<CommitmentDirection>('outgoing')
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
        direction,
        status: 'open',
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="mb-6 space-y-3 rounded-xl border border-gray-700 bg-gray-900 p-4">
      {/* Direction toggle — small but always visible so the user can flip */}
      <div className="flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-800 p-0.5 text-xs w-fit">
        <button
          type="button"
          onClick={() => setDirection('outgoing')}
          className={`flex items-center gap-1 rounded px-2 py-1 transition-colors ${
            direction === 'outgoing'
              ? 'bg-amber-700/40 text-amber-200'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <ArrowUpRight size={11} />
          I owe
        </button>
        <button
          type="button"
          onClick={() => setDirection('incoming')}
          className={`flex items-center gap-1 rounded px-2 py-1 transition-colors ${
            direction === 'incoming'
              ? 'bg-blue-700/40 text-blue-200'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <ArrowDownLeft size={11} />
          Owed to me
        </button>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={direction === 'outgoing' ? 'What did you commit to?' : 'What did they commit to do for you?'}
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
          placeholder={direction === 'outgoing' ? 'For (whom)' : 'From (whom)'}
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
