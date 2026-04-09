import { useMemo } from 'react'
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
} from 'lucide-react'
import { useCommitments, useSetCommitmentStatus, useDeleteCommitment } from '../hooks/useCommitments'
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
        {totalLive > 0 && (
          <span className="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300">
            {totalLive} open
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : !commitments || commitments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 px-6 py-16 text-center">
          <Handshake size={32} className="mx-auto text-gray-700" />
          <h2 className="mt-3 text-sm font-medium text-gray-400">No commitments yet</h2>
          <p className="mt-1 text-xs text-gray-600">
            When AI extracts soft promises from a transcript, they'll show up here for tracking.
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
