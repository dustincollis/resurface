import { useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Inbox, X, BarChart3 } from 'lucide-react'
import { useProposals } from '../hooks/useProposals'
import { usePendingProposalGroupsByMeeting } from '../hooks/useProposalGroups'
import { usePendingPursuitLinkProposals } from '../hooks/usePursuitLinkProposals'
import ProposalCard from '../components/ProposalCard'
import GroupingSuggestion from '../components/GroupingSuggestion'
import PursuitLinkSuggestion from '../components/PursuitLinkSuggestion'
import TriageSkippedSection from '../components/TriageSkippedSection'
import type { ProposalSourceType } from '../lib/types'

export default function Proposals() {
  const [searchParams, setSearchParams] = useSearchParams()
  const sourceType = searchParams.get('source_type') as ProposalSourceType | null
  const sourceId = searchParams.get('source_id')

  const filter = useMemo(
    () => ({
      ...(sourceType ? { source_type: sourceType } : {}),
      ...(sourceId ? { source_id: sourceId } : {}),
    }),
    [sourceType, sourceId]
  )

  const { data: proposals, isLoading } = useProposals(filter)

  // Grouping suggestions only render when filtered to a single meeting --
  // they need a meeting context to be coherent.
  const meetingFilterId = sourceType === 'meeting' ? sourceId : null
  const { data: pendingGroups } = usePendingProposalGroupsByMeeting(meetingFilterId)

  // Pursuit-link suggestions are per-meeting by nature. Fetch all pending and
  // filter to the active meeting when the page is filtered; otherwise show all.
  const { data: allPursuitLinks } = usePendingPursuitLinkProposals()
  const visiblePursuitLinks = useMemo(() => {
    if (!allPursuitLinks) return []
    if (meetingFilterId) {
      return allPursuitLinks.filter((p) => p.source_meeting_id === meetingFilterId)
    }
    return allPursuitLinks
  }, [allPursuitLinks, meetingFilterId])

  const clearFilter = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('source_type')
    next.delete('source_id')
    setSearchParams(next)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Proposals</h1>
          <p className="mt-1 text-sm text-gray-400">
            AI-extracted items waiting for your review. Accept, edit, merge into existing work, or dismiss.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isLoading && proposals && (
            <span className="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300">
              {proposals.length} pending
            </span>
          )}
          <Link
            to="/proposals/analytics"
            className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-700 hover:text-gray-200"
          >
            <BarChart3 size={12} />
            Analytics
          </Link>
        </div>
      </div>

      {(sourceType || sourceId) && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-xs">
          <span className="text-gray-500">Filtered to:</span>
          {sourceType && (
            <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-300">
              source: {sourceType}
            </span>
          )}
          {sourceId && (
            <Link
              to={sourceType === 'meeting' ? `/meetings/${sourceId}` : '#'}
              className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-300 hover:bg-gray-700"
            >
              {sourceId.substring(0, 8)}
            </Link>
          )}
          <button
            onClick={clearFilter}
            className="ml-auto flex items-center gap-1 text-gray-500 hover:text-gray-300"
          >
            <X size={12} />
            Clear
          </button>
        </div>
      )}

      <TriageSkippedSection />

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : (!proposals || proposals.length === 0) && visiblePursuitLinks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 px-6 py-16 text-center">
          <Inbox size={32} className="mx-auto text-gray-700" />
          <h2 className="mt-3 text-sm font-medium text-gray-400">Nothing to review</h2>
          <p className="mt-1 text-xs text-gray-600">
            When AI extracts action items from a transcript, they'll land here for approval.
          </p>
        </div>
      ) : (
        <>
          {visiblePursuitLinks.length > 0 && (
            <div>
              {visiblePursuitLinks.map((p) => (
                <PursuitLinkSuggestion key={p.id} proposal={p} />
              ))}
            </div>
          )}
          {pendingGroups && pendingGroups.length > 0 && (
            <div>
              {pendingGroups.map((g) => (
                <GroupingSuggestion key={g.id} group={g} />
              ))}
            </div>
          )}
          <div className="space-y-3">
            {(proposals ?? []).map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
