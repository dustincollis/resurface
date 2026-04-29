import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, Mail, Trash2, X } from 'lucide-react'
import {
  useDismissFollowUp,
  useMarkAllSent,
  useMarkRecipientSent,
  useUpdateFollowUp,
} from '../hooks/useFollowUps'
import type { FollowUp, FollowUpRecipient, FollowUpWithMeeting } from '../lib/types'

interface Props {
  followUp: FollowUp | FollowUpWithMeeting
  // Hide the meeting link header (used when rendered inline on MeetingDetail).
  hideMeetingLink?: boolean
}

// Pre-formatted, ready to paste. The user copies this and pastes into Outlook.
function clipboardText(r: FollowUpRecipient): string {
  const lines: string[] = []
  if (r.email) lines.push(`To: ${r.email}`)
  lines.push(`Subject: ${r.draft_subject}`)
  lines.push('')
  lines.push(r.draft_body)
  return lines.join('\n')
}

export default function FollowUpCard({ followUp, hideMeetingLink }: Props) {
  const meeting = (followUp as FollowUpWithMeeting).meeting ?? null
  const dismiss = useDismissFollowUp()
  const markSent = useMarkRecipientSent()
  const markAllSent = useMarkAllSent()
  const updateFollowUp = useUpdateFollowUp()

  const [recipients, setRecipients] = useState<FollowUpRecipient[]>(followUp.recipients)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  const sentCount = recipients.filter((r) => r.sent_at).length
  const allSent = recipients.length > 0 && sentCount === recipients.length
  const someSent = sentCount > 0 && !allSent

  function patchRecipient(i: number, patch: Partial<FollowUpRecipient>) {
    setRecipients((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  async function persistEdit() {
    setEditingIndex(null)
    await updateFollowUp.mutateAsync({
      id: followUp.id,
      patch: { recipients },
    })
  }

  async function handleCopyAndSend(i: number) {
    const r = recipients[i]
    try {
      await navigator.clipboard.writeText(clipboardText(r))
    } catch (err) {
      console.warn('clipboard write failed:', err)
    }
    setCopiedIndex(i)
    setTimeout(() => setCopiedIndex((cur) => (cur === i ? null : cur)), 1500)
    await markSent.mutateAsync({ id: followUp.id, recipientIndex: i })
  }

  async function handleDismiss() {
    if (!confirm('Dismiss this follow-up? It won\'t be sent.')) return
    await dismiss.mutateAsync(followUp.id)
  }

  async function handleSendAll() {
    // Copy a single concatenated payload (separated by ---) and mark all sent.
    const text = recipients
      .filter((r) => !r.sent_at)
      .map(clipboardText)
      .join('\n\n---\n\n')
    if (text) {
      try { await navigator.clipboard.writeText(text) } catch (e) { console.warn(e) }
    }
    await markAllSent.mutateAsync(followUp.id)
  }

  const isDismissed = followUp.status === 'dismissed'
  const isFullySent = followUp.status === 'sent'

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
              {isFullySent && (
                <span className="rounded bg-green-600/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-300">
                  Sent
                </span>
              )}
              {isDismissed && (
                <span className="rounded bg-gray-700 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-400">
                  Dismissed
                </span>
              )}
              {someSent && !isFullySent && (
                <span className="rounded bg-yellow-600/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-yellow-300">
                  {sentCount} of {recipients.length} sent
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
          {!isDismissed && !isFullySent && (
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

      {/* Recipients */}
      <div className="divide-y divide-gray-800">
        {recipients.map((r, i) => {
          const sent = !!r.sent_at
          const editing = editingIndex === i
          const copied = copiedIndex === i
          return (
            <div key={i} className="px-5 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <Mail size={12} className="shrink-0 text-gray-500" />
                    <span className="font-medium text-white">{r.name}</span>
                    {r.email && (
                      <span className="truncate text-xs text-gray-500">&lt;{r.email}&gt;</span>
                    )}
                    {sent && (
                      <span className="ml-1 inline-flex items-center gap-1 rounded bg-green-600/20 px-1.5 py-0.5 text-[10px] font-semibold text-green-300">
                        <Check size={10} /> Sent
                      </span>
                    )}
                  </div>
                  {r.rationale && (
                    <p className="mt-0.5 text-[11px] text-gray-500">{r.rationale}</p>
                  )}
                </div>
              </div>

              {editing ? (
                <div className="space-y-2">
                  <input
                    value={r.draft_subject}
                    onChange={(e) => patchRecipient(i, { draft_subject: e.target.value })}
                    className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white focus:border-cyan-500 focus:outline-none"
                    placeholder="Subject"
                  />
                  <textarea
                    value={r.draft_body}
                    onChange={(e) => patchRecipient(i, { draft_body: e.target.value })}
                    rows={6}
                    className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100 focus:border-cyan-500 focus:outline-none"
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
                        setRecipients(followUp.recipients)
                        setEditingIndex(null)
                      }}
                      className="rounded px-2 py-1 text-[11px] text-gray-400 hover:text-gray-200"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    {r.draft_subject}
                  </p>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-gray-200">
                    {r.draft_body}
                  </pre>
                  {!sent && !isDismissed && (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => handleCopyAndSend(i)}
                        className="inline-flex items-center gap-1.5 rounded bg-cyan-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-cyan-500"
                      >
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                        {copied ? 'Copied — marked sent' : 'Copy & mark sent'}
                      </button>
                      <button
                        onClick={() => setEditingIndex(i)}
                        className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-200"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      {!isDismissed && !isFullySent && recipients.length > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-gray-800 px-5 py-2">
          <button
            onClick={handleSendAll}
            className="inline-flex items-center gap-1.5 rounded border border-cyan-600 px-2.5 py-1 text-xs font-medium text-cyan-300 hover:bg-cyan-600/10"
          >
            <Check size={12} /> Mark all sent
          </button>
        </div>
      )}
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
