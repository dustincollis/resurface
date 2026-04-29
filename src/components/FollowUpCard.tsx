import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, Trash2, Users, X } from 'lucide-react'
import {
  useDismissFollowUp,
  useMarkFollowUpSent,
  useUpdateFollowUp,
} from '../hooks/useFollowUps'
import type { FollowUp, FollowUpWithMeeting } from '../lib/types'

interface Props {
  followUp: FollowUp | FollowUpWithMeeting
  // Hide the meeting link header (used when rendered inline on MeetingDetail).
  hideMeetingLink?: boolean
}

// Recipients shown as "Justin, Dyana, and Sean" so the To line reads naturally.
function formatRecipientList(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

export default function FollowUpCard({ followUp, hideMeetingLink }: Props) {
  const meeting = (followUp as FollowUpWithMeeting).meeting ?? null
  const dismiss = useDismissFollowUp()
  const markSent = useMarkFollowUpSent()
  const updateFollowUp = useUpdateFollowUp()

  const [draftSubject, setDraftSubject] = useState(followUp.draft_subject)
  const [draftBody, setDraftBody] = useState(followUp.draft_body)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)

  const isDismissed = followUp.status === 'dismissed'
  const isSent = followUp.status === 'sent'
  const recipientNames = followUp.recipients.map((r) => r.name)

  async function handleCopyAndSend() {
    try {
      await navigator.clipboard.writeText(draftBody)
    } catch (err) {
      console.warn('clipboard write failed:', err)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    if (!isSent) {
      await markSent.mutateAsync(followUp.id)
    }
  }

  async function persistEdit() {
    setEditing(false)
    await updateFollowUp.mutateAsync({
      id: followUp.id,
      patch: { draft_subject: draftSubject, draft_body: draftBody },
    })
  }

  async function handleDismiss() {
    if (!confirm("Dismiss this follow-up? It won't be sent.")) return
    await dismiss.mutateAsync(followUp.id)
  }

  return (
    <div className={`rounded-xl border bg-gray-900 ${isDismissed ? 'border-gray-800 opacity-60' : 'border-gray-800'}`}>
      {/* Header */}
      <div className="border-b border-gray-800 px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded bg-cyan-600/20 px-2 py-0.5 text-xs font-semibold text-cyan-300">
                Follow-up
              </span>
              {isSent && (
                <span className="inline-flex items-center gap-1 rounded bg-green-600/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-300">
                  <Check size={10} /> Sent
                </span>
              )}
              {isDismissed && (
                <span className="rounded bg-gray-700 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-400">
                  Dismissed
                </span>
              )}
            </div>
            {!hideMeetingLink && meeting && (
              <Link
                to={`/meetings/${meeting.id}`}
                className="mt-1 block truncate text-sm text-gray-300 hover:text-white"
              >
                {meeting.title ?? 'Untitled meeting'}
              </Link>
            )}
            {followUp.rationale && (
              <p className="mt-1 text-xs text-gray-500">{followUp.rationale}</p>
            )}
          </div>
          {!isDismissed && !isSent && (
            <button
              onClick={handleDismiss}
              className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
              title="Dismiss"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        {followUp.evidence_text && (
          <blockquote className="mt-2 border-l-2 border-gray-700 pl-3 text-xs italic text-gray-500">
            "{followUp.evidence_text}"
          </blockquote>
        )}
      </div>

      {/* Recipients (To line) */}
      <div className="border-b border-gray-800 px-5 py-2">
        <div className="flex items-start gap-2 text-xs text-gray-400">
          <Users size={12} className="mt-0.5 shrink-0 text-gray-500" />
          <div className="min-w-0 flex-1">
            <span className="text-gray-500">To: </span>
            <span className="text-gray-200">{formatRecipientList(recipientNames)}</span>
            {followUp.recipients.some((r) => r.email) && (
              <span className="ml-1 text-gray-500">
                ({followUp.recipients.filter((r) => r.email).map((r) => r.email).join(', ')})
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Subject + body */}
      <div className="px-5 py-4">
        {editing ? (
          <div className="space-y-2">
            <input
              value={draftSubject}
              onChange={(e) => setDraftSubject(e.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white focus:border-cyan-500 focus:outline-none"
              placeholder="Subject"
            />
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={10}
              className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-cyan-500 focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={persistEdit}
                className="rounded bg-cyan-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-cyan-500"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setDraftSubject(followUp.draft_subject)
                  setDraftBody(followUp.draft_body)
                  setEditing(false)
                }}
                className="rounded px-2 py-1 text-[11px] text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">
              {draftSubject}
            </p>
            <pre className="whitespace-pre-wrap font-sans text-sm text-gray-200">
              {draftBody}
            </pre>
            {!isDismissed && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={handleCopyAndSend}
                  className="inline-flex items-center gap-1.5 rounded bg-cyan-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-cyan-500"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied
                    ? 'Copied' + (isSent ? '' : ' — marked sent')
                    : isSent
                      ? 'Copy body'
                      : 'Copy & mark sent'}
                </button>
                <button
                  onClick={() => setEditing(true)}
                  className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-200"
                >
                  Edit
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {isDismissed && (
        <div className="flex items-center justify-end border-t border-gray-800 px-5 py-2">
          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
            <X size={12} /> Dismissed
          </span>
        </div>
      )}
    </div>
  )
}
