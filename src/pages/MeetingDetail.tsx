import { useState, useEffect, type ReactNode } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Upload, Loader2, CheckCircle, HelpCircle, Inbox, Trash2, ChevronRight, Check, Plus, Archive, Radio } from 'lucide-react'
import { useMeeting, useUploadTranscript, useDeleteMeeting, useUpdateMeeting, type MeetingImportMode } from '../hooks/useMeetings'
import { useItemsByDiscussion, useCreateItem } from '../hooks/useItems'
import { useProposalsBySource } from '../hooks/useProposals'
import { useCommitmentsByMeeting } from '../hooks/useCommitments'
import { queryClient } from '../lib/queryClient'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import StatusBadge from '../components/StatusBadge'
import InlineEditable from '../components/InlineEditable'
import type { Item } from '../lib/types'

// Render inline markdown: **bold**, *italic*, `code`
function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = []
  let key = 0
  // Match **bold**, *italic*, or `code`
  const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[2]) {
      parts.push(<strong key={key++} className="font-semibold text-gray-200">{match[2]}</strong>)
    } else if (match[3]) {
      parts.push(<em key={key++} className="italic">{match[3]}</em>)
    } else if (match[4]) {
      parts.push(<code key={key++} className="rounded bg-gray-800 px-1 py-0.5 text-xs text-gray-300">{match[4]}</code>)
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts.length > 0 ? parts : text
}

export default function MeetingDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: meeting, isLoading } = useMeeting(id!)
  const { data: linkedTasks } = useItemsByDiscussion(id!)
  const { data: meetingProposals } = useProposalsBySource('meeting', id!)
  const { data: meetingCommitments } = useCommitmentsByMeeting(id!)
  const uploadTranscript = useUploadTranscript()
  const updateMeeting = useUpdateMeeting()
  const deleteMeeting = useDeleteMeeting()
  const createItem = useCreateItem()
  const [transcriptText, setTranscriptText] = useState('')
  const [showTranscriptInput, setShowTranscriptInput] = useState(true)
  const [pendingMode, setPendingMode] = useState<MeetingImportMode>('active')
  // Tracks which open-question / decision indices have been converted into items
  const [createdFromQuestion, setCreatedFromQuestion] = useState<Map<number, Item>>(new Map())
  const [createdFromDecision, setCreatedFromDecision] = useState<Map<number, Item>>(new Map())

  // Default the upload picker to the meeting's current mode whenever the
  // meeting loads/changes, so a fresh visit shows the right pre-selection.
  useEffect(() => {
    if (meeting) setPendingMode(meeting.import_mode)
  }, [meeting?.id, meeting?.import_mode])

  if (isLoading || !meeting) {
    return <div className="text-gray-400">Loading...</div>
  }

  const pendingCount = meetingProposals?.filter((p) => p.status === 'pending').length ?? 0
  const reviewedCount = meetingProposals?.filter((p) => p.status !== 'pending').length ?? 0

  const handleUpload = async () => {
    if (!transcriptText.trim()) return
    // Apply the chosen mode to the meeting before parsing, so the edge
    // function reads the right import_mode when it runs.
    if (pendingMode !== meeting.import_mode) {
      await updateMeeting.mutateAsync({ id: meeting.id, import_mode: pendingMode })
    }
    uploadTranscript.mutate(
      { meetingId: meeting.id, transcript: transcriptText.trim() },
      { onSuccess: () => setShowTranscriptInput(false) }
    )
  }

  const handleSwitchMode = async (newMode: MeetingImportMode) => {
    if (newMode === meeting.import_mode) return
    await updateMeeting.mutateAsync({ id: meeting.id, import_mode: newMode })

    if (newMode === 'archive') {
      // Switching to archive: drop any pending proposals from this meeting,
      // they're no longer considered live commitments.
      await supabase
        .from('proposals')
        .delete()
        .eq('user_id', user!.id)
        .eq('source_type', 'meeting')
        .eq('source_id', meeting.id)
        .eq('status', 'pending')
      queryClient.invalidateQueries({ queryKey: ['proposals'] })
    } else if (newMode === 'active' && meeting.transcript) {
      // Switching to active: re-parse the existing transcript so proposals
      // get extracted. Reuses the upload pipeline.
      uploadTranscript.mutate({
        meetingId: meeting.id,
        transcript: meeting.transcript,
      })
    }
  }

  const handleCreateFromQuestion = (
    index: number,
    question: { question: string; owner?: string }
  ) => {
    createItem.mutate(
      {
        title: question.question,
        description: `Open question raised in: ${meeting.title}`,
        source_meeting_id: meeting.id,
      },
      {
        onSuccess: (item) => {
          setCreatedFromQuestion((prev) => new Map(prev).set(index, item))
        },
      }
    )
  }

  const handleCreateFromDecision = (
    index: number,
    decision: { decision: string; context?: string }
  ) => {
    const descParts = [`Decision made in: ${meeting.title}`]
    if (decision.context) descParts.push(`Context: ${decision.context}`)
    createItem.mutate(
      {
        title: decision.decision,
        description: descParts.join('\n\n'),
        source_meeting_id: meeting.id,
      },
      {
        onSuccess: (item) => {
          setCreatedFromDecision((prev) => new Map(prev).set(index, item))
        },
      }
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => navigate('/meetings')}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"
        >
          <ArrowLeft size={16} /> Back to Discussions
        </button>
        <button
          onClick={() => { deleteMeeting.mutate(meeting.id); navigate('/meetings') }}
          className="flex items-center gap-1 rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-red-400"
          title="Delete discussion"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Meeting info */}
      <div className="rounded-xl border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <InlineEditable
                as="h1"
                value={meeting.title}
                onSave={(newTitle) =>
                  updateMeeting.mutate({ id: meeting.id, title: newTitle })
                }
                className="text-xl font-semibold text-white"
                placeholder="Untitled discussion"
              />
            </div>
            <div className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-gray-700 bg-gray-800 p-0.5 text-[11px]">
              <button
                onClick={() => handleSwitchMode('active')}
                disabled={updateMeeting.isPending}
                className={`flex items-center gap-1 rounded px-2 py-1 transition-colors ${
                  meeting.import_mode === 'active'
                    ? 'bg-green-700/40 text-green-200'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                title="Active: a current discussion. Action items become live proposals."
              >
                <Radio size={11} />
                Active
              </button>
              <button
                onClick={() => handleSwitchMode('archive')}
                disabled={updateMeeting.isPending}
                className={`flex items-center gap-1 rounded px-2 py-1 transition-colors ${
                  meeting.import_mode === 'archive'
                    ? 'bg-gray-600/60 text-gray-200'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                title="Archive: an older recording. Summarized but no proposals created."
              >
                <Archive size={11} />
                Archive
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-400">
            {meeting.start_time && (
              <span>
                {new Date(meeting.start_time).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            )}
            {meeting.location && <span>{meeting.location}</span>}
          </div>
          {meeting.attendees && meeting.attendees.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {meeting.attendees.map((a, i) => (
                <span key={i} className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Processing indicator */}
        {uploadTranscript.isPending && (
          <div className="border-b border-gray-800 px-6 py-6">
            <div className="flex items-center gap-3">
              <Loader2 size={20} className="animate-spin text-purple-400" />
              <div>
                <p className="text-sm font-medium text-white">Processing transcript...</p>
                <p className="text-xs text-gray-500">Analyzing discussion content, extracting action items, decisions, and open questions. This may take 15-30 seconds.</p>
              </div>
            </div>
          </div>
        )}

        {/* Discussion synopsis */}
        {meeting.transcript_summary && (
          <div className="border-b border-gray-800 px-6 py-4">
            <h3 className="mb-3 text-sm font-medium text-gray-300">Synopsis</h3>
            <div className="synopsis space-y-3 text-sm leading-relaxed text-gray-400">
              {meeting.transcript_summary.split('\n').map((line, i) => {
                const trimmed = line.trim()
                if (!trimmed) return null
                if (trimmed.startsWith('## ')) {
                  return (
                    <h4 key={i} className="mt-4 text-xs font-semibold uppercase tracking-wider text-gray-300">
                      {renderInline(trimmed.slice(3))}
                    </h4>
                  )
                }
                if (trimmed.startsWith('# ')) {
                  return (
                    <h4 key={i} className="mt-4 text-sm font-semibold text-gray-200">
                      {renderInline(trimmed.slice(2))}
                    </h4>
                  )
                }
                if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                  return (
                    <div key={i} className="flex gap-2 pl-1">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-600" />
                      <span>{renderInline(trimmed.slice(2))}</span>
                    </div>
                  )
                }
                return <p key={i}>{renderInline(trimmed)}</p>
              })}
            </div>
          </div>
        )}

        {/* Linked Tasks (created from this discussion) */}
        {linkedTasks && linkedTasks.length > 0 && (
          <div className="border-b border-gray-800 px-6 py-4">
            <h3 className="mb-3 text-sm font-medium text-gray-300">
              Tasks from this discussion ({linkedTasks.length})
            </h3>
            <div className="space-y-1.5">
              {linkedTasks.map((task) => {
                const streamColor = task.streams?.color ?? '#6B7280'
                return (
                  <button
                    key={task.id}
                    onClick={() => navigate(`/items/${task.id}`)}
                    className="flex w-full items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2 text-left transition-colors hover:border-gray-700 hover:bg-gray-900"
                  >
                    <ChevronRight size={14} className="flex-shrink-0 text-gray-600" />
                    <div
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: streamColor }}
                    />
                    <span className="flex-1 truncate text-sm text-gray-200">
                      {task.title}
                    </span>
                    {task.streams && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                        style={{
                          backgroundColor: `${streamColor}20`,
                          color: streamColor,
                        }}
                      >
                        {task.streams.name}
                      </span>
                    )}
                    <StatusBadge status={task.status} />
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Commitments tied to this discussion */}
        {meetingCommitments && meetingCommitments.length > 0 && (
          <div className="border-b border-gray-800 px-6 py-4">
            <h3 className="mb-3 text-sm font-medium text-gray-300">
              Commitments from this discussion ({meetingCommitments.length})
            </h3>
            <div className="space-y-1.5">
              {meetingCommitments.map((c) => (
                <Link
                  key={c.id}
                  to="/commitments"
                  className="flex w-full items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2 text-left transition-colors hover:border-gray-700 hover:bg-gray-900"
                >
                  <ChevronRight size={14} className="flex-shrink-0 text-gray-600" />
                  <span className="flex-1 truncate text-sm text-gray-200">{c.title}</span>
                  {c.counterpart && (
                    <span className="flex-shrink-0 rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-300">
                      for {c.counterpart}
                    </span>
                  )}
                  {c.do_by && (
                    <span className="flex-shrink-0 text-[10px] text-gray-500">
                      by {new Date(c.do_by + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  <span
                    className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                      c.status === 'open'
                        ? 'bg-amber-900/30 text-amber-300'
                        : c.status === 'met'
                          ? 'bg-green-900/30 text-green-300'
                          : c.status === 'waiting'
                            ? 'bg-blue-900/30 text-blue-300'
                            : 'bg-gray-800 text-gray-500'
                    }`}
                  >
                    {c.status}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Extracted action items → Proposals queue */}
        {(pendingCount > 0 || reviewedCount > 0) && (
          <div className="border-b border-gray-800 px-6 py-4">
            <h3 className="mb-3 text-sm font-medium text-gray-300">Action Items</h3>
            <Link
              to={`/proposals?source_type=meeting&source_id=${meeting.id}`}
              className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2.5 transition-colors hover:border-gray-700 hover:bg-gray-900"
            >
              <Inbox size={16} className="flex-shrink-0 text-purple-400" />
              <div className="flex-1 text-sm">
                {pendingCount > 0 ? (
                  <span className="text-gray-200">
                    {pendingCount} item{pendingCount !== 1 ? 's' : ''} extracted, awaiting review
                  </span>
                ) : (
                  <span className="text-gray-400">
                    {reviewedCount} item{reviewedCount !== 1 ? 's' : ''} reviewed
                  </span>
                )}
                {pendingCount > 0 && reviewedCount > 0 && (
                  <span className="ml-2 text-xs text-gray-500">
                    ({reviewedCount} already reviewed)
                  </span>
                )}
              </div>
              <ChevronRight size={14} className="text-gray-600" />
            </Link>
          </div>
        )}

        {/* Decisions */}
        {meeting.extracted_decisions && meeting.extracted_decisions.length > 0 && (
          <div className="border-b border-gray-800 px-6 py-4">
            <h3 className="mb-3 text-sm font-medium text-gray-300">Decisions</h3>
            <div className="space-y-2">
              {meeting.extracted_decisions.map((d, i) => {
                const created = createdFromDecision.get(i)
                return (
                  <div key={i} className="flex items-start gap-2">
                    <CheckCircle size={14} className="mt-0.5 flex-shrink-0 text-green-400" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-200">{d.decision}</span>
                      {d.context && (
                        <p className="mt-0.5 text-xs text-gray-500">{d.context}</p>
                      )}
                      {created && (
                        <p className="mt-1 text-xs text-green-400">
                          Task created
                          {' · '}
                          <button
                            onClick={() => navigate(`/items/${created.id}`)}
                            className="text-purple-400 hover:text-purple-300"
                          >
                            View item
                          </button>
                        </p>
                      )}
                    </div>
                    {!created && (
                      <button
                        onClick={() => handleCreateFromDecision(i, d)}
                        disabled={createItem.isPending}
                        className="flex flex-shrink-0 items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
                        title="Create a follow-up task for this decision"
                      >
                        <Plus size={11} />
                        Create task
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Open questions */}
        {meeting.extracted_open_questions && meeting.extracted_open_questions.length > 0 && (
          <div className="border-b border-gray-800 px-6 py-4">
            <h3 className="mb-3 text-sm font-medium text-gray-300">Open Questions</h3>
            <div className="space-y-2">
              {meeting.extracted_open_questions.map((q, i) => {
                const created = createdFromQuestion.get(i)
                return (
                  <div key={i} className="flex items-start gap-2">
                    <HelpCircle size={14} className="mt-0.5 flex-shrink-0 text-yellow-400" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-200">{q.question}</span>
                      {q.owner && (
                        <span className="ml-2 text-xs text-gray-500">({q.owner})</span>
                      )}
                      {created && (
                        <p className="mt-1 text-xs text-green-400">
                          Task created
                          {' · '}
                          <button
                            onClick={() => navigate(`/items/${created.id}`)}
                            className="text-purple-400 hover:text-purple-300"
                          >
                            View item
                          </button>
                        </p>
                      )}
                    </div>
                    {!created && (
                      <button
                        onClick={() => handleCreateFromQuestion(i, q)}
                        disabled={createItem.isPending}
                        className="flex flex-shrink-0 items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
                        title="Create a task to address this question"
                      >
                        <Plus size={11} />
                        Create task
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Transcript viewer */}
        {meeting.transcript && (
          <div className="border-b border-gray-800 px-6 py-4">
            <h3 className="mb-2 text-sm font-medium text-gray-300">Source Content</h3>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-gray-800 p-3 text-xs text-gray-400">
              {meeting.transcript}
            </pre>
          </div>
        )}

        {/* Upload transcript */}
        <div className="px-6 py-4">
          {!showTranscriptInput ? (
            <button
              onClick={() => setShowTranscriptInput(true)}
              className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              <Upload size={14} />
              {meeting.transcript ? 'Update Discussion Notes' : 'Add Discussion Notes'}
            </button>
          ) : (
            <div className="space-y-3">
              <textarea
                value={transcriptText}
                onChange={(e) => setTranscriptText(e.target.value)}
                placeholder="Paste transcript, meeting notes, or any discussion content..."
                rows={8}
                className="block w-full resize-y rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                autoFocus
              />
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-800 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setPendingMode('active')}
                    className={`flex items-center gap-1 rounded px-2 py-1 transition-colors ${
                      pendingMode === 'active'
                        ? 'bg-green-700/40 text-green-200'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <Radio size={11} />
                    Active
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingMode('archive')}
                    className={`flex items-center gap-1 rounded px-2 py-1 transition-colors ${
                      pendingMode === 'archive'
                        ? 'bg-gray-600/60 text-gray-200'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <Archive size={11} />
                    Archive
                  </button>
                </div>
                <span className="text-[11px] text-gray-500">
                  {pendingMode === 'active'
                    ? 'Action items become live proposals'
                    : 'Summarized only, no proposals created'}
                </span>
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={handleUpload}
                    disabled={!transcriptText.trim() || uploadTranscript.isPending}
                    className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                  >
                    {uploadTranscript.isPending ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Processing...
                      </>
                    ) : (
                      'Analyze'
                    )}
                  </button>
                  <button
                    onClick={() => { setShowTranscriptInput(false); setTranscriptText('') }}
                    className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:text-gray-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {uploadTranscript.isError && (
            <div className="mt-2 rounded border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              <div className="font-medium">Failed to process.</div>
              <div className="mt-1 break-words font-mono text-[11px] text-red-400/90">
                {uploadTranscript.error instanceof Error
                  ? uploadTranscript.error.message
                  : String(uploadTranscript.error)}
              </div>
            </div>
          )}

          {uploadTranscript.isSuccess && uploadTranscript.data && (() => {
            const data = uploadTranscript.data as {
              proposals_created?: number
              not_for_user?: number
              skipped_speculative?: number
            }
            const count = data.proposals_created ?? 0
            const notForUser = data.not_for_user ?? 0
            const skippedSpec = data.skipped_speculative ?? 0
            return (
              <div className="mt-2 rounded border border-green-900/40 bg-green-950/30 px-3 py-2 text-xs">
                {count === 0 && skippedSpec === 0 ? (
                  <div className="flex items-center gap-2 text-gray-300">
                    <Check size={14} className="text-green-400" />
                    <span>Processed. No action items extracted from this discussion.</span>
                  </div>
                ) : count === 0 ? (
                  <div className="flex items-center gap-2 text-gray-300">
                    <Check size={14} className="text-green-400" />
                    <span>
                      Processed. No real action items — {skippedSpec} speculative item{skippedSpec !== 1 ? 's' : ''} dropped.
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-green-200">
                    <Check size={14} className="text-green-400" />
                    <span>
                      {count} proposal{count !== 1 ? 's' : ''} created from this discussion.
                    </span>
                    {notForUser > 0 && (
                      <span className="text-gray-400">
                        · {notForUser} {notForUser === 1 ? 'is' : 'are'} for other people (triage in queue)
                      </span>
                    )}
                    {skippedSpec > 0 && (
                      <span className="text-gray-400">· {skippedSpec} speculative dropped</span>
                    )}
                    <Link
                      to={`/proposals?source_type=meeting&source_id=${meeting.id}`}
                      className="ml-auto font-medium text-green-100 underline hover:text-white"
                    >
                      Review →
                    </Link>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
