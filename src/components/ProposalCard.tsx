import { useState } from 'react'
import {
  CheckSquare,
  Handshake,
  Brain,
  FileEdit,
  CalendarClock,
  Quote,
  Check,
  X,
  Pencil,
  GitMerge,
  Trash2,
  AlertTriangle,
  Loader2,
  ArrowUpRight,
  ArrowDownLeft,
  Target,
} from 'lucide-react'
import { useStreams } from '../hooks/useStreams'
import { useSearch } from '../hooks/useSearch'
import {
  useAcceptProposal,
  useRejectProposal,
  useMergeProposal,
  defaultAcceptAs,
  type AcceptAs,
} from '../hooks/useProposals'
import { usePursuits, useCreatePursuit } from '../hooks/usePursuits'
import type {
  Proposal,
  ProposalType,
  TaskProposalPayload,
  CommitmentProposalPayload,
} from '../lib/types'

interface ProposalCardProps {
  proposal: Proposal
}

const TYPE_META: Record<
  ProposalType,
  { icon: typeof CheckSquare; label: string; supported: boolean }
> = {
  task: { icon: CheckSquare, label: 'Task', supported: true },
  commitment: { icon: Handshake, label: 'Commitment', supported: true },
  memory: { icon: Brain, label: 'Memory', supported: false },
  draft: { icon: FileEdit, label: 'Draft', supported: false },
  deadline_adjustment: { icon: CalendarClock, label: 'Deadline change', supported: false },
}

export default function ProposalCard({ proposal }: ProposalCardProps) {
  const parserSuggestion = TYPE_META[proposal.proposal_type]
  const [mode, setMode] = useState<'view' | 'edit' | 'merge'>('view')
  // The user picks the target type at acceptance time. Defaults to the
  // parser's suggestion (task → 'task', commitment → 'commitment_outgoing'),
  // but the user can override.
  const [acceptAs, setAcceptAs] = useState<AcceptAs>(defaultAcceptAs(proposal))
  const [pursuitId, setPursuitId] = useState<string | null>(null)

  const acceptMut = useAcceptProposal()
  const rejectMut = useRejectProposal()
  const mergeMut = useMergeProposal()
  const createPursuit = useCreatePursuit()
  const { data: activePursuits } = usePursuits({ status: 'active' })
  const [creatingPursuit, setCreatingPursuit] = useState(false)
  const [newPursuitName, setNewPursuitName] = useState('')
  const busy = acceptMut.isPending || rejectMut.isPending || mergeMut.isPending || createPursuit.isPending

  const handleCreatePursuit = async () => {
    if (!newPursuitName.trim()) return
    try {
      const pursuit = await createPursuit.mutateAsync({ name: newPursuitName.trim() })
      setPursuitId(pursuit.id)
      setNewPursuitName('')
      setCreatingPursuit(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      alert(`Could not create pursuit: ${msg}`)
    }
  }

  const confidenceColor =
    proposal.confidence == null
      ? 'bg-gray-800 text-gray-400'
      : proposal.confidence >= 0.8
        ? 'bg-green-900/40 text-green-300'
        : proposal.confidence >= 0.5
          ? 'bg-yellow-900/40 text-yellow-300'
          : 'bg-orange-900/40 text-orange-300'

  // Pull account context from the payload for the prominent header.
  // Both task and commitment payloads carry a `company` field.
  const payload = proposal.normalized_payload as unknown as
    | (Partial<TaskProposalPayload> & Partial<CommitmentProposalPayload>)
    | undefined
  const company = payload?.company ?? null
  const sourceTitle = proposal.source_title ?? null

  // Drive the rendering choice from the user's selection, not the parser's
  // suggestion. The interpretation and editor switch when the chip changes.
  const showAsCommitment = acceptAs !== 'task'

  const handleAccept = () => {
    acceptMut.mutate({ proposal, acceptAs, pursuitId })
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900">
      {/* Header — account context is the first thing the eye lands on */}
      <div className="flex items-start justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {company && (
              <span className="rounded bg-blue-600/20 px-2 py-0.5 text-xs font-semibold text-blue-300">
                {company}
              </span>
            )}
            {sourceTitle && (
              <span className="truncate text-xs text-gray-400">
                from "{sourceTitle}"
              </span>
            )}
            {!company && !sourceTitle && (
              <span className="text-xs text-gray-600">No source context</span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
              AI suggested: {parserSuggestion.label}
            </span>
            {!parserSuggestion.supported && (
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">
                not yet supported
              </span>
            )}
          </div>
        </div>
        {proposal.confidence != null && (
          <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${confidenceColor}`}>
            {Math.round(proposal.confidence * 100)}%
          </span>
        )}
      </div>

      {/* Evidence quote — only when we have a real verbatim quote.
          The AI's own paraphrase is not evidence and should not appear here. */}
      {proposal.evidence_text && (
        <div className="border-b border-gray-800 px-4 py-3">
          <div className="flex gap-2 text-sm italic text-gray-400">
            <Quote size={14} className="mt-0.5 flex-shrink-0 text-gray-600" />
            <span className="leading-relaxed">{proposal.evidence_text}</span>
          </div>
        </div>
      )}

      {/* Structured interpretation */}
      <div className="px-4 py-3">
        {parserSuggestion.supported ? (
          mode === 'edit' ? (
            showAsCommitment ? (
              <CommitmentEditor
                proposal={proposal}
                onCancel={() => setMode('view')}
                onSave={(edited) => {
                  acceptMut.mutate(
                    {
                      proposal,
                      acceptAs,
                      pursuitId,
                      editedPayload: edited as unknown as Record<string, unknown>,
                    },
                    { onSuccess: () => setMode('view') }
                  )
                }}
                busy={busy}
              />
            ) : (
              <TaskEditor
                proposal={proposal}
                onCancel={() => setMode('view')}
                onSave={(edited) => {
                  acceptMut.mutate(
                    {
                      proposal,
                      acceptAs,
                      pursuitId,
                      editedPayload: edited as unknown as Record<string, unknown>,
                    },
                    { onSuccess: () => setMode('view') }
                  )
                }}
                busy={busy}
              />
            )
          ) : mode === 'merge' ? (
            <MergePicker
              onCancel={() => setMode('view')}
              onPick={(itemId) => {
                mergeMut.mutate(
                  { proposal, targetItemId: itemId },
                  { onSuccess: () => setMode('view') }
                )
              }}
              busy={busy}
            />
          ) : showAsCommitment ? (
            <CommitmentInterpretation proposal={proposal} />
          ) : (
            <TaskInterpretation proposal={proposal} />
          )
        ) : (
          <div className="text-xs text-gray-500">
            Acceptance for this proposal type lands in a later chunk. You can still dismiss it.
          </div>
        )}
      </div>

      {/* Type + Pursuit selector — only shown in view mode (edit mode
          embeds these decisions in its own form for clarity) */}
      {parserSuggestion.supported && mode === 'view' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-800 px-4 py-2.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
            Save as
          </span>
          <div className="flex items-center gap-0.5 rounded-lg border border-gray-700 bg-gray-800 p-0.5">
            <button
              type="button"
              onClick={() => setAcceptAs('task')}
              disabled={busy}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50 ${
                acceptAs === 'task'
                  ? 'bg-purple-700/40 text-purple-200'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <CheckSquare size={10} />
              Task
            </button>
            <button
              type="button"
              onClick={() => setAcceptAs('commitment_outgoing')}
              disabled={busy}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50 ${
                acceptAs === 'commitment_outgoing'
                  ? 'bg-amber-700/40 text-amber-200'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
              title="Outgoing commitment — you owe someone"
            >
              <ArrowUpRight size={10} />
              I owe
            </button>
            <button
              type="button"
              onClick={() => setAcceptAs('commitment_incoming')}
              disabled={busy}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50 ${
                acceptAs === 'commitment_incoming'
                  ? 'bg-blue-700/40 text-blue-200'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
              title="Incoming commitment — owed to you"
            >
              <ArrowDownLeft size={10} />
              Owed to me
            </button>
          </div>

          {/* Pursuit selector — always show; users can create a new pursuit
              inline even if they have zero existing ones */}
          <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
            · Pursuit
          </span>
          {creatingPursuit ? (
            <div className="flex items-center gap-1">
              <input
                value={newPursuitName}
                onChange={(e) => setNewPursuitName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreatePursuit()
                  if (e.key === 'Escape') {
                    setCreatingPursuit(false)
                    setNewPursuitName('')
                  }
                }}
                placeholder="New pursuit name..."
                autoFocus
                disabled={busy}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-[11px] text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleCreatePursuit}
                disabled={!newPursuitName.trim() || busy}
                className="rounded bg-purple-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-purple-500 disabled:opacity-50"
              >
                {createPursuit.isPending ? <Loader2 size={10} className="animate-spin" /> : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatingPursuit(false)
                  setNewPursuitName('')
                }}
                disabled={busy}
                className="rounded px-1.5 py-0.5 text-[11px] text-gray-400 hover:text-gray-200 disabled:opacity-50"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-800 px-1.5 py-0.5">
              <Target size={10} className="text-gray-500" />
              <select
                value={pursuitId ?? ''}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setCreatingPursuit(true)
                  } else {
                    setPursuitId(e.target.value || null)
                  }
                }}
                disabled={busy}
                className="border-none bg-transparent text-[11px] text-gray-300 focus:outline-none disabled:opacity-50"
              >
                <option value="">none</option>
                {(activePursuits ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="__new__">+ Create new pursuit...</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* Ambiguity flags */}
      {proposal.ambiguity_flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-gray-800 px-4 py-2">
          {proposal.ambiguity_flags.map((flag) => (
            <span
              key={flag}
              className="flex items-center gap-1 rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-300"
            >
              <AlertTriangle size={10} />
              {flag.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {/* Action row */}
      {mode === 'view' && (
        <div className="flex flex-wrap gap-2 border-t border-gray-800 px-4 py-2.5">
          {parserSuggestion.supported && (
            <>
              <button
                onClick={handleAccept}
                disabled={busy}
                className="flex items-center gap-1.5 rounded bg-green-600/20 px-2.5 py-1 text-xs font-medium text-green-300 hover:bg-green-600/30 disabled:opacity-50"
              >
                {acceptMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                {acceptAs === 'task'
                  ? 'Save as task'
                  : acceptAs === 'commitment_outgoing'
                    ? 'Save as outgoing commitment'
                    : 'Save as incoming commitment'}
              </button>
              <button
                onClick={() => setMode('edit')}
                disabled={busy}
                className="flex items-center gap-1.5 rounded bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-300 hover:bg-gray-700 disabled:opacity-50"
              >
                <Pencil size={12} />
                Edit
              </button>
              {acceptAs === 'task' && (
                <button
                  onClick={() => setMode('merge')}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-300 hover:bg-gray-700 disabled:opacity-50"
                >
                  <GitMerge size={12} />
                  Merge into existing
                </button>
              )}
            </>
          )}
          <button
            onClick={() => rejectMut.mutate({ proposalId: proposal.id, action: 'not_actionable' })}
            disabled={busy}
            className="flex items-center gap-1.5 rounded bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-400 hover:bg-gray-700 disabled:opacity-50"
          >
            <X size={12} />
            Not actionable
          </button>
          <button
            onClick={() => rejectMut.mutate({ proposalId: proposal.id, action: 'dismiss_banter' })}
            disabled={busy}
            className="ml-auto flex items-center gap-1.5 rounded px-2.5 py-1 text-xs text-gray-500 hover:text-gray-300 disabled:opacity-50"
          >
            <Trash2 size={12} />
            Dismiss as banter
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Task interpretation (read-only)
// ============================================================

function TaskInterpretation({ proposal }: { proposal: Proposal }) {
  const p = proposal.normalized_payload as unknown as TaskProposalPayload
  return (
    <div className="space-y-1.5">
      <div className="text-base font-semibold text-white">{p.title}</div>
      {p.description && (
        <div className="text-xs leading-relaxed text-gray-400">{p.description}</div>
      )}
      <div className="flex flex-wrap gap-2 pt-1 text-xs">
        {p.due_date && (
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-300">
            due {new Date(p.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
        {p.assignee && p.assignee !== 'user' && (
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-400">
            assignee: {p.assignee}
          </span>
        )}
        {p.urgency && (
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-400">
            {p.urgency}
          </span>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Task editor (used when user clicks Edit)
// ============================================================

interface TaskEditorProps {
  proposal: Proposal
  onSave: (payload: TaskProposalPayload) => void
  onCancel: () => void
  busy: boolean
}

function TaskEditor({ proposal, onSave, onCancel, busy }: TaskEditorProps) {
  const initial = proposal.normalized_payload as unknown as TaskProposalPayload
  const { data: streams } = useStreams()
  const [title, setTitle] = useState(initial.title ?? '')
  const [description, setDescription] = useState(initial.description ?? '')
  const [nextAction, setNextAction] = useState(initial.next_action ?? '')
  const [dueDate, setDueDate] = useState(initial.due_date ?? '')
  const [streamId, setStreamId] = useState(initial.stream_id ?? '')
  const [company, setCompany] = useState(initial.company ?? '')

  const handleSave = () => {
    if (!title.trim()) return
    onSave({
      ...initial,
      title: title.trim(),
      description: description.trim() || undefined,
      next_action: nextAction.trim() || null,
      due_date: dueDate || null,
      stream_id: streamId || null,
      company: company.trim() || null,
    })
  }

  return (
    <div className="space-y-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
        autoFocus
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description"
        rows={2}
        className="w-full resize-y rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
      />
      <input
        value={nextAction}
        onChange={(e) => setNextAction(e.target.value)}
        placeholder="Next action"
        className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          value={dueDate ?? ''}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
        />
        <select
          value={streamId ?? ''}
          onChange={(e) => setStreamId(e.target.value)}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
        >
          <option value="">No stream</option>
          {streams?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Company"
          className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={busy || !title.trim()}
          className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Save & accept
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ============================================================
// Commitment interpretation (read-only)
// ============================================================

function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function CommitmentInterpretation({ proposal }: { proposal: Proposal }) {
  const p = proposal.normalized_payload as unknown as CommitmentProposalPayload
  return (
    <div className="space-y-1.5">
      <div className="text-base font-semibold text-white">{p.title}</div>
      {p.description && (
        <div className="text-xs leading-relaxed text-gray-400">{p.description}</div>
      )}
      <div className="flex flex-wrap gap-2 pt-1 text-xs">
        {p.counterpart && (
          <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-amber-300">
            for {p.counterpart}
          </span>
        )}
        {p.do_by && (
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-300">
            do by {formatDate(p.do_by)}
          </span>
        )}
        {p.promised_by && p.promised_by !== p.do_by && (
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-400">
            promised by {formatDate(p.promised_by)}
          </span>
        )}
        {p.needs_review_by && (
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-400">
            review by {formatDate(p.needs_review_by)}
          </span>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Commitment editor
// ============================================================

interface CommitmentEditorProps {
  proposal: Proposal
  onSave: (payload: CommitmentProposalPayload) => void
  onCancel: () => void
  busy: boolean
}

function CommitmentEditor({ proposal, onSave, onCancel, busy }: CommitmentEditorProps) {
  const initial = proposal.normalized_payload as unknown as CommitmentProposalPayload
  const [title, setTitle] = useState(initial.title ?? '')
  const [description, setDescription] = useState(initial.description ?? '')
  const [counterpart, setCounterpart] = useState(initial.counterpart ?? '')
  const [doBy, setDoBy] = useState(initial.do_by ?? '')
  const [promisedBy, setPromisedBy] = useState(initial.promised_by ?? '')
  const [needsReviewBy, setNeedsReviewBy] = useState(initial.needs_review_by ?? '')
  const [company, setCompany] = useState(initial.company ?? '')
  const [showExtraDates, setShowExtraDates] = useState(
    Boolean(initial.promised_by || initial.needs_review_by)
  )

  const handleSave = () => {
    if (!title.trim()) return
    onSave({
      ...initial,
      title: title.trim(),
      description: description.trim() || undefined,
      counterpart: counterpart.trim() || null,
      do_by: doBy || null,
      promised_by: promisedBy || null,
      needs_review_by: needsReviewBy || null,
      company: company.trim() || null,
    })
  }

  return (
    <div className="space-y-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Commitment"
        className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
        autoFocus
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Notes"
        rows={2}
        className="w-full resize-y rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        <input
          value={counterpart}
          onChange={(e) => setCounterpart(e.target.value)}
          placeholder="For (counterpart)"
          className="flex-1 min-w-[120px] rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
        />
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Company"
          className="flex-1 min-w-[120px] rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] uppercase tracking-wider text-gray-500">Do by</label>
        <input
          type="date"
          value={doBy ?? ''}
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
            value={promisedBy ?? ''}
            onChange={(e) => setPromisedBy(e.target.value)}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
          />
          <label className="text-[11px] uppercase tracking-wider text-gray-500">Review by</label>
          <input
            type="date"
            value={needsReviewBy ?? ''}
            onChange={(e) => setNeedsReviewBy(e.target.value)}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
          />
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={busy || !title.trim()}
          className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Save & accept
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ============================================================
// Merge picker (search existing items)
// ============================================================

interface MergePickerProps {
  onPick: (itemId: string) => void
  onCancel: () => void
  busy: boolean
}

function MergePicker({ onPick, onCancel, busy }: MergePickerProps) {
  const [query, setQuery] = useState('')
  const { data: results, isLoading } = useSearch(query, query.length >= 2)
  const itemResults = results?.filter((r) => r.result_type === 'item') ?? []

  return (
    <div className="space-y-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search existing items..."
        className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
        autoFocus
      />
      <div className="max-h-48 overflow-y-auto rounded border border-gray-800">
        {query.length < 2 ? (
          <div className="px-2 py-3 text-xs text-gray-500">Type to search...</div>
        ) : isLoading ? (
          <div className="px-2 py-3 text-xs text-gray-500">Searching...</div>
        ) : itemResults.length === 0 ? (
          <div className="px-2 py-3 text-xs text-gray-500">No matching items.</div>
        ) : (
          itemResults.map((r) => (
            <button
              key={r.result_id}
              onClick={() => onPick(r.result_id)}
              disabled={busy}
              className="flex w-full flex-col items-start border-b border-gray-800 px-2 py-1.5 text-left text-xs hover:bg-gray-800 disabled:opacity-50"
            >
              <span className="text-gray-200">{r.title}</span>
              {r.stream_name && (
                <span className="text-[10px] text-gray-500">{r.stream_name}</span>
              )}
            </button>
          ))
        )}
      </div>
      <button
        onClick={onCancel}
        disabled={busy}
        className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  )
}
