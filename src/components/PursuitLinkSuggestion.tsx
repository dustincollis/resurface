import { Link } from 'react-router-dom'
import { Sparkles, Check, X, Loader2, Target, Calendar } from 'lucide-react'
import {
  useAcceptPursuitLinkProposal,
  useRejectPursuitLinkProposal,
} from '../hooks/usePursuitLinkProposals'
import { usePursuit } from '../hooks/usePursuits'
import { useMeeting } from '../hooks/useMeetings'
import type { PursuitLinkProposal } from '../lib/types'

interface Props {
  proposal: PursuitLinkProposal
}

export default function PursuitLinkSuggestion({ proposal }: Props) {
  const { data: pursuit } = usePursuit(proposal.suggested_pursuit_id)
  const { data: meeting } = useMeeting(proposal.source_meeting_id)
  const accept = useAcceptPursuitLinkProposal()
  const reject = useRejectPursuitLinkProposal()

  const isPending = accept.isPending || reject.isPending

  return (
    <div className="mb-4 rounded-xl border border-purple-900/50 bg-purple-950/20 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-purple-300">
        <Sparkles size={12} />
        AI suggests linking this meeting to a pursuit
        {typeof proposal.confidence === 'number' && (
          <span className="ml-1 text-purple-500">
            ({Math.round(proposal.confidence * 100)}% confident)
          </span>
        )}
      </div>

      <div className="mb-3 space-y-2">
        {meeting && (
          <Link
            to={`/meetings/${meeting.id}`}
            className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 hover:border-gray-700"
          >
            <Calendar size={12} className="flex-shrink-0 text-gray-500" />
            <span className="flex-1 truncate text-sm text-gray-200">{meeting.title}</span>
            {meeting.start_time && (
              <span className="text-[10px] text-gray-500">
                {new Date(meeting.start_time).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            )}
          </Link>
        )}

        {pursuit && (
          <Link
            to={`/pursuits/${pursuit.id}`}
            className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 hover:border-gray-700"
          >
            <Target size={12} className="flex-shrink-0" style={{ color: pursuit.color }} />
            <span className="flex-1 truncate text-sm text-gray-200">{pursuit.name}</span>
            {pursuit.company && (
              <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] text-blue-300">
                {pursuit.company}
              </span>
            )}
          </Link>
        )}
      </div>

      {proposal.reasoning && (
        <p className="mb-3 text-xs text-gray-400 italic">{proposal.reasoning}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => accept.mutate(proposal)}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {accept.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Check size={12} />
          )}
          Link to pursuit
        </button>
        <button
          onClick={() => reject.mutate(proposal.id)}
          disabled={isPending}
          className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50"
        >
          {reject.isPending ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
          Dismiss
        </button>
      </div>

      {accept.isError && (
        <p className="mt-2 text-xs text-red-400">
          Failed to link. {(accept.error as Error)?.message}
        </p>
      )}
    </div>
  )
}
