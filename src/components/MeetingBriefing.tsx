import React, { useState } from 'react'
import { Loader2, Sparkles, Users, ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface PersonContext {
  person_id: string
  name: string
  company: string | null
  role: string | null
  commitments_you_owe: { title: string; do_by: string | null; status: string }[]
  commitments_they_owe: { title: string; do_by: string | null; status: string }[]
  recent_meetings: { title: string; date: string }[]
  shared_pursuits: { name: string; status: string }[]
}

interface BriefingData {
  attendees: PersonContext[]
  briefing: string | null
}

export default function MeetingBriefing({ meetingId }: { meetingId: string }) {
  const [data, setData] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meeting-briefing`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ meeting_id: meetingId }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to generate briefing')
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  if (!data && !loading) {
    return (
      <button
        onClick={generate}
        className="flex w-full items-center gap-2 rounded-lg border border-purple-800/40 bg-purple-950/20 px-4 py-3 text-sm text-purple-300 transition-colors hover:border-purple-700/60 hover:bg-purple-950/40"
      >
        <Sparkles size={16} />
        Generate pre-meeting briefing
      </button>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-4 py-4">
        <Loader2 size={16} className="animate-spin text-purple-400" />
        <div>
          <p className="text-sm text-gray-200">Generating briefing...</p>
          <p className="text-xs text-gray-500">Looking up attendees, commitments, and meeting history</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/40 bg-red-950/30 px-4 py-3">
        <p className="text-xs text-red-300">{error}</p>
        <button onClick={generate} className="mt-1 text-xs text-red-400 underline hover:text-red-300">
          Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  const hasContext = data.attendees.some(
    (a) =>
      a.commitments_you_owe.length > 0 ||
      a.commitments_they_owe.length > 0 ||
      a.recent_meetings.length > 0 ||
      a.shared_pursuits.length > 0
  )

  return (
    <div className="space-y-3">
      {/* AI briefing */}
      {data.briefing && (
        <div className="rounded-lg border border-purple-800/30 bg-purple-950/10 px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-purple-300">
            <Sparkles size={12} />
            Pre-Meeting Briefing
          </div>
          <div className="prose prose-invert prose-sm max-w-none text-sm leading-relaxed text-gray-300">
            {data.briefing.split('\n').map((line, i) => {
              const t = line.trim()
              if (!t) return <br key={i} />
              if (t.startsWith('### ')) return <h4 key={i} className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">{t.slice(4)}</h4>
              if (t.startsWith('## ')) return <h3 key={i} className="mt-3 mb-1 text-sm font-semibold text-gray-200">{t.slice(3)}</h3>
              if (t.startsWith('# ')) return <h3 key={i} className="mt-3 mb-1 text-sm font-semibold text-gray-200">{t.slice(2)}</h3>
              if (t.startsWith('- ') || t.startsWith('* ')) {
                return (
                  <div key={i} className="flex gap-2 py-0.5">
                    <span className="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-purple-400/60" />
                    <span>{renderBold(t.slice(2))}</span>
                  </div>
                )
              }
              return <p key={i} className="py-0.5">{renderBold(t)}</p>
            })}
          </div>
        </div>
      )}

      {/* Attendee details (collapsible) */}
      {hasContext && (
        <div className="rounded-lg border border-gray-800 bg-gray-950/40">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-xs font-medium text-gray-400 hover:text-gray-300"
          >
            {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Users size={12} />
            Attendee details ({data.attendees.length} people)
          </button>
          {showDetails && (
            <div className="border-t border-gray-800 px-4 py-3 space-y-4">
              {data.attendees.map((a) => (
                <div key={a.person_id}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-900/30 text-[10px] font-medium text-purple-300">
                      {a.name.charAt(0)}
                    </div>
                    <span className="text-sm font-medium text-gray-200">{a.name}</span>
                    {a.company && <span className="text-xs text-gray-500">{a.company}</span>}
                    {a.role && <span className="text-xs text-gray-600">· {a.role}</span>}
                  </div>

                  <div className="ml-8 space-y-1 text-xs">
                    {a.commitments_you_owe.length > 0 && (
                      <div>
                        <span className="text-red-400/80">You owe:</span>
                        {a.commitments_you_owe.map((c, i) => (
                          <div key={i} className="ml-2 text-gray-400">
                            · {c.title}{c.do_by ? ` (due ${c.do_by})` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                    {a.commitments_they_owe.length > 0 && (
                      <div>
                        <span className="text-blue-400/80">They owe you:</span>
                        {a.commitments_they_owe.map((c, i) => (
                          <div key={i} className="ml-2 text-gray-400">
                            · {c.title}{c.do_by ? ` (due ${c.do_by})` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                    {a.recent_meetings.length > 0 && (
                      <div className="text-gray-500">
                        Last met: {a.recent_meetings[0].title} ({a.recent_meetings[0].date})
                        {a.recent_meetings.length > 1 && ` +${a.recent_meetings.length - 1} more`}
                      </div>
                    )}
                    {a.shared_pursuits.length > 0 && (
                      <div className="text-gray-500">
                        Pursuits: {a.shared_pursuits.map((p) => p.name).join(', ')}
                      </div>
                    )}
                    {a.commitments_you_owe.length === 0 && a.commitments_they_owe.length === 0 && a.recent_meetings.length === 0 && (
                      <div className="text-gray-600 italic">No prior history</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={generate}
        className="text-[11px] text-gray-500 hover:text-gray-400"
      >
        Refresh briefing
      </button>
    </div>
  )
}

// Simple bold rendering: **text** → <strong>
function renderBold(text: string) {
  const parts: (string | React.ReactElement)[] = []
  const regex = /\*\*([^*]+)\*\*/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push(<strong key={key++} className="font-semibold text-gray-200">{match[1]}</strong>)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
