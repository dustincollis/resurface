import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Upload, Loader2, CheckCircle, HelpCircle, AlertCircle } from 'lucide-react'
import { useMeeting, useUploadTranscript } from '../hooks/useMeetings'
import { useCreateItem } from '../hooks/useItems'

export default function MeetingDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: meeting, isLoading } = useMeeting(id!)
  const uploadTranscript = useUploadTranscript()
  const createItem = useCreateItem()
  const [transcriptText, setTranscriptText] = useState('')
  const [showTranscriptInput, setShowTranscriptInput] = useState(false)

  if (isLoading || !meeting) {
    return <div className="text-gray-400">Loading...</div>
  }

  const handleUpload = () => {
    if (!transcriptText.trim()) return
    uploadTranscript.mutate({
      meetingId: meeting.id,
      transcript: transcriptText.trim(),
    })
    setShowTranscriptInput(false)
  }

  const handleCreateItemFromAction = (action: { title: string; description?: string }) => {
    createItem.mutate({
      title: action.title,
      description: action.description ?? '',
    })
  }

  return (
    <div className="mx-auto max-w-3xl">
      <button
        onClick={() => navigate('/meetings')}
        className="mb-4 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"
      >
        <ArrowLeft size={16} /> Back to Meetings
      </button>

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

        {/* Transcript summary */}
        {meeting.transcript_summary && (
          <div className="border-b border-gray-800 px-6 py-4">
            <h3 className="mb-2 text-sm font-medium text-gray-300">Summary</h3>
            <p className="text-sm text-gray-400">{meeting.transcript_summary}</p>
          </div>
        )}

        {/* Action items */}
        {meeting.extracted_action_items && meeting.extracted_action_items.length > 0 && (
          <div className="border-b border-gray-800 px-6 py-4">
            <h3 className="mb-3 text-sm font-medium text-gray-300">Action Items</h3>
            <div className="space-y-2">
              {meeting.extracted_action_items.map((action, i) => (
                <div key={i} className="flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-orange-400" />
                  <div className="flex-1">
                    <span className="text-sm text-gray-200">{action.title}</span>
                    {action.assignee && (
                      <span className="ml-2 text-xs text-gray-500">({action.assignee})</span>
                    )}
                    {action.description && (
                      <p className="mt-0.5 text-xs text-gray-500">{action.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleCreateItemFromAction(action)}
                    className="flex-shrink-0 rounded bg-purple-600/20 px-2 py-1 text-xs text-purple-300 hover:bg-purple-600/30"
                  >
                    Create Item
                  </button>
                </div>
              ))}
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
            <h3 className="mb-2 text-sm font-medium text-gray-300">Transcript</h3>
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
              {meeting.transcript ? 'Replace Transcript' : 'Upload Transcript'}
            </button>
          ) : (
            <div className="space-y-3">
              <textarea
                value={transcriptText}
                onChange={(e) => setTranscriptText(e.target.value)}
                placeholder="Paste your transcript here..."
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
                    'Upload & Parse'
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
              Failed to process transcript. Make sure the ai-parse-transcript edge function is deployed.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
