import { useEffect, useMemo, useState } from 'react'
import { Sparkles, X, Check, Loader2, FolderTree } from 'lucide-react'
import { useProposals } from '../hooks/useProposals'
import {
  useAcceptProposalGroup,
  useRejectProposalGroup,
  useRemoveFromProposalGroup,
} from '../hooks/useProposalGroups'
import type { ProposalGroup, Proposal, TaskProposalPayload } from '../lib/types'

interface Props {
  group: ProposalGroup
}

export default function GroupingSuggestion({ group }: Props) {
  const { data: allProposals } = useProposals({ source_type: 'meeting', source_id: group.source_meeting_id })
  const [title, setTitle] = useState(group.suggested_title)
  const acceptGroup = useAcceptProposalGroup()
  const rejectGroup = useRejectProposalGroup()
  const removeMember = useRemoveFromProposalGroup()

  // Reset the editable title whenever the AI re-suggests a different one
  // (e.g. realtime update after a re-process).
  useEffect(() => {
    setTitle(group.suggested_title)
  }, [group.suggested_title])

  const memberProposals = useMemo(() => {
    const byId = new Map<string, Proposal>(
      (allProposals ?? []).map((p) => [p.id, p])
    )
    return group.proposal_ids
      .map((id) => byId.get(id))
      .filter((p): p is Proposal => !!p && p.status === 'pending')
  }, [allProposals, group.proposal_ids])

  // If realtime removed the last members (e.g. user accepted them individually),
  // hide the banner -- an empty group is meaningless.
  if (memberProposals.length === 0) return null

  const handleAccept = () => {
    if (!title.trim()) return
    acceptGroup.mutate({ group, title: title.trim() })
  }

  const handleReject = () => {
    rejectGroup.mutate(group.id)
  }

  const handleRemove = (proposalId: string) => {
    removeMember.mutate({ group, proposalId })
  }

  const isPending = acceptGroup.isPending || rejectGroup.isPending

  return (
    <div className="mb-4 rounded-xl border border-purple-900/50 bg-purple-950/20 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-purple-300">
        <Sparkles size={12} />
        AI suggests grouping these {memberProposals.length} proposals
        {typeof group.confidence === 'number' && (
          <span className="ml-1 text-purple-500">({Math.round(group.confidence * 100)}% confident)</span>
        )}
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">
          Parent task title
        </label>
        <div className="flex items-center gap-2">
          <FolderTree size={14} className="flex-shrink-0 text-purple-400" />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isPending}
            placeholder="What is this work?"
            className="flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-white placeholder:text-gray-600 focus:border-purple-600 focus:outline-none disabled:opacity-50"
          />
        </div>
      </div>

      <div className="mb-3 space-y-1.5">
        {memberProposals.map((p) => {
          const payload = p.normalized_payload as unknown as TaskProposalPayload
          return (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-gray-200">
                {payload.title ?? '(untitled)'}
              </span>
              <button
                onClick={() => handleRemove(p.id)}
                disabled={isPending || removeMember.isPending}
                title="Remove from group (will be triaged individually)"
                className="rounded p-1 text-gray-600 hover:bg-gray-800 hover:text-gray-300 disabled:opacity-50"
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleAccept}
          disabled={isPending || !title.trim() || memberProposals.length < 2}
          className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {acceptGroup.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Check size={12} />
          )}
          Accept grouping
        </button>
        <button
          onClick={handleReject}
          disabled={isPending}
          className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50"
        >
          {rejectGroup.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            'Reject'
          )}
        </button>
        <span className="ml-auto text-[11px] text-gray-600">
          Reject = items go through normal triage
        </span>
      </div>

      {acceptGroup.isError && (
        <p className="mt-2 text-xs text-red-400">
          Failed to create group. {(acceptGroup.error as Error)?.message}
        </p>
      )}
    </div>
  )
}
