import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Loader2, Plus, Check, ChevronRight, X } from 'lucide-react'
import {
  useChildItems,
  useDecomposeItem,
  useCreateItem,
  type ProposedSubTask,
} from '../hooks/useItems'
import StatusBadge from './StatusBadge'
import type { Item } from '../lib/types'

interface ProposedSubTaskRowProps {
  proposal: ProposedSubTask
  parentId: string
  parentStreamId: string | null
}

function ProposedSubTaskRow({ proposal, parentId, parentStreamId }: ProposedSubTaskRowProps) {
  const createItem = useCreateItem()
  const [created, setCreated] = useState(false)

  const handleCreate = () => {
    createItem.mutate(
      {
        title: proposal.title,
        description: proposal.description,
        next_action: proposal.next_action,
        due_date: proposal.suggested_due_date,
        parent_id: parentId,
        stream_id: parentStreamId,
      },
      { onSuccess: () => setCreated(true) }
    )
  }

  return (
    <div
      className={`rounded-lg border p-3 ${
        created ? 'border-green-800/50 bg-green-900/10' : 'border-gray-700 bg-gray-900'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p
            className={`text-sm font-medium ${
              created ? 'text-gray-500 line-through' : 'text-gray-200'
            }`}
          >
            {proposal.title}
          </p>
          {proposal.description && !created && (
            <p className="mt-0.5 text-xs text-gray-500">{proposal.description}</p>
          )}
          {proposal.next_action && !created && (
            <p className="mt-1 text-xs text-gray-400">Next: {proposal.next_action}</p>
          )}
          {proposal.suggested_due_date && !created && (
            <span className="mt-1 inline-block rounded bg-blue-900/40 px-1.5 py-0.5 text-[11px] text-blue-300">
              due {new Date(proposal.suggested_due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        {created ? (
          <div className="flex items-center gap-1 text-xs text-green-400">
            <Check size={12} /> Created
          </div>
        ) : (
          <button
            onClick={handleCreate}
            disabled={createItem.isPending}
            className="flex flex-shrink-0 items-center gap-1 rounded bg-purple-600 px-2 py-1 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
          >
            <Plus size={12} /> Create
          </button>
        )}
      </div>
    </div>
  )
}

interface DecomposeSectionProps {
  item: Item
}

export default function DecomposeSection({ item }: DecomposeSectionProps) {
  const navigate = useNavigate()
  const { data: children } = useChildItems(item.id)
  const decompose = useDecomposeItem()
  const [proposals, setProposals] = useState<ProposedSubTask[] | null>(null)

  const handleDecompose = () => {
    decompose.mutate(item.id, {
      onSuccess: (data) => {
        setProposals(data.sub_tasks)
      },
    })
  }

  const handleClearProposals = () => {
    setProposals(null)
  }

  const hasChildren = children && children.length > 0

  return (
    <div className="border-b border-gray-800 px-6 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300">
          Sub-items{hasChildren ? ` (${children.length})` : ''}
        </h3>
        <button
          onClick={handleDecompose}
          disabled={decompose.isPending}
          className="flex items-center gap-1.5 rounded-lg border border-purple-700 bg-purple-900/30 px-3 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-900/50 disabled:opacity-50"
        >
          {decompose.isPending ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              Thinking...
            </>
          ) : (
            <>
              <Sparkles size={12} />
              Break down
            </>
          )}
        </button>
      </div>

      {/* Existing children */}
      {hasChildren && (
        <div className="mb-3 space-y-1.5">
          {children.map((child) => (
            <button
              key={child.id}
              onClick={() => navigate(`/items/${child.id}`)}
              className="flex w-full items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-left transition-colors hover:border-gray-700"
            >
              <ChevronRight size={14} className="flex-shrink-0 text-gray-600" />
              <span className="flex-1 truncate text-sm text-gray-200">{child.title}</span>
              <StatusBadge status={child.status} />
            </button>
          ))}
        </div>
      )}

      {/* Proposed sub-tasks */}
      {proposals && proposals.length > 0 && (
        <div className="mt-3 rounded-lg border border-purple-900/50 bg-purple-950/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-purple-400">
              AI Proposals
            </p>
            <button
              onClick={handleClearProposals}
              className="text-gray-500 hover:text-gray-300"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
          <div className="space-y-2">
            {proposals.map((proposal, i) => (
              <ProposedSubTaskRow
                key={i}
                proposal={proposal}
                parentId={item.id}
                parentStreamId={item.stream_id}
              />
            ))}
          </div>
        </div>
      )}

      {decompose.isError && (
        <p className="mt-2 text-xs text-red-400">
          Failed to break down item. Make sure the ai-decompose edge function is deployed.
        </p>
      )}

      {!hasChildren && !proposals && !decompose.isPending && (
        <p className="text-xs text-gray-600">
          Click &ldquo;Break down&rdquo; to get AI-suggested sub-tasks for this item.
        </p>
      )}
    </div>
  )
}
