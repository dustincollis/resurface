import { useState, type ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Upload, Loader2, CheckCircle, HelpCircle, AlertCircle, Trash2, Check, ChevronRight } from 'lucide-react'
import { useMeeting, useUploadTranscript, useDeleteMeeting } from '../hooks/useMeetings'
import { useCreateItem, useItemsByDiscussion } from '../hooks/useItems'
import StatusBadge from '../components/StatusBadge'
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
  const { data: meeting, isLoading } = useMeeting(id!)
  const { data: linkedTasks } = useItemsByDiscussion(id!)
  const uploadTranscript = useUploadTranscript()
  const deleteMeeting = useDeleteMeeting()
  const createItem = useCreateItem()
  const [transcriptText, setTranscriptText] = useState('')
  const [showTranscriptInput, setShowTranscriptInput] = useState(true)
  const [createdItems, setCreatedItems] = useState<Map<number, Item>>(new Map())

  if (isLoading || !meeting) {
    return <div className="text-gray-400">Loading...</div>
  }

  const handleUpload = () => {
    if (!transcriptText.trim()) return
    uploadTranscript.mutate(
      { meetingId: meeting.id, transcript: transcriptText.trim() },
      { onSuccess: () => setShowTranscriptInput(false) }
    )
  }

  const handleCreateItemFromAction = (
    index: number,
    action: { title: string; description?: string; suggested_due_date?: string | null }
  ) => {
    const desc = action.description
      ? `${action.description}\n\nFrom discussion: ${meeting.title}`
      : `From discussion: ${meeting.title}`
    createItem.mutate(
      {
        title: action.title,
        description: desc,
        source_meeting_id: meeting.id,
        due_date: action.suggested_due_date ?? null,
      },
      {
        onSuccess: (item) => {
          setCreatedItems((prev) => new Map(prev).set(index, item))
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
          <h1 className="text-xl font-semibold text-white">{meeting.title}</h1>
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

        {/* Action items */}
        {meeting.extracted_action_items && meeting.extracted_action_items.length > 0 && (
          <div className="border-b border-gray-800 px-6 py-4">
            <h3 className="mb-3 text-sm font-medium text-gray-300">Action Items</h3>
            <div className="space-y-2">
              {meeting.extracted_action_items.map((action, i) => {
                const created = createdItems.get(i)
                return (
                  <div key={i} className="flex items-start gap-2">
                    {created ? (
                      <Check size={14} className="mt-0.5 flex-shrink-0 text-green-400" />
                    ) : (
                      <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-orange-400" />
                    )}
                    <div className="flex-1">
                      <span className={`text-sm ${created ? 'text-gray-500' : 'text-gray-200'}`}>
                        {action.title}
                      </span>
                      {action.assignee && (
                        <span className="ml-2 text-xs text-gray-500">({action.assignee})</span>
                      )}
                      {action.suggested_due_date && !created && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded bg-blue-900/40 px-1.5 py-0.5 text-xs text-blue-300">
                          due {new Date(action.suggested_due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                      {action.description && (
                        <p className="mt-0.5 text-xs text-gray-500">{action.description}</p>
                      )}
                      {created && (
                        <p className="mt-1 text-xs text-green-400">
                          Created — {created.streams?.name ? `added to ${created.streams.name}` : 'no stream yet (AI classifying...)'}
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
                        onClick={() => handleCreateItemFromAction(i, action)}
                        className="flex-shrink-0 rounded bg-purple-600/20 px-2 py-1 text-xs text-purple-300 hover:bg-purple-600/30"
                      >
                        Create Item
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Decisions */}
        {meeting.extracted_decisions && meeting.extracted_decisions.length > 0 && (
          <div className="border-b border-gray-800 px-6 py-4">
            <h3 className="mb-3 text-sm font-medium text-gray-300">Decisions</h3>
            <div className="space-y-2">
              {meeting.extracted_decisions.map((d, i) => (
                <div key={i} className="flex items-start gap-2">
                  <CheckCircle size={14} className="mt-0.5 flex-shrink-0 text-green-400" />
                  <div>
                    <span className="text-sm text-gray-200">{d.decision}</span>
                    {d.context && (
                      <p className="mt-0.5 text-xs text-gray-500">{d.context}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Open questions */}
        {meeting.extracted_open_questions && meeting.extracted_open_questions.length > 0 && (
          <div className="border-b border-gray-800 px-6 py-4">
            <h3 className="mb-3 text-sm font-medium text-gray-300">Open Questions</h3>
            <div className="space-y-2">
              {meeting.extracted_open_questions.map((q, i) => (
                <div key={i} className="flex items-start gap-2">
                  <HelpCircle size={14} className="mt-0.5 flex-shrink-0 text-yellow-400" />
                  <div>
                    <span className="text-sm text-gray-200">{q.question}</span>
                    {q.owner && (
                      <span className="ml-2 text-xs text-gray-500">({q.owner})</span>
                    )}
                  </div>
                </div>
              ))}
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
              <div className="flex gap-2">
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
          )}

          {uploadTranscript.isError && (
            <p className="mt-2 text-xs text-red-400">
              Failed to process. Make sure the ai-parse-transcript edge function is deployed.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
