import { useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Trophy,
  Frown,
  Archive,
  RotateCcw,
  Trash2,
  Target,
  CheckSquare,
  Handshake,
  Calendar,
  ChevronRight,
} from 'lucide-react'
import {
  usePursuit,
  usePursuitMembers,
  useUpdatePursuit,
  useSetPursuitStatus,
  useDeletePursuit,
  useRemovePursuitMember,
} from '../hooks/usePursuits'
import { useItems } from '../hooks/useItems'
import { useCommitments } from '../hooks/useCommitments'
import { useMeetings } from '../hooks/useMeetings'
import InlineEditable from '../components/InlineEditable'
import StatusBadge from '../components/StatusBadge'
import PlaybookHealth from '../components/PlaybookHealth'
import type { Item, Commitment } from '../lib/types'
import type { Meeting } from '../hooks/useMeetings'

export default function PursuitDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: pursuit, isLoading } = usePursuit(id!)
  const { data: members } = usePursuitMembers(id!)
  const updatePursuit = useUpdatePursuit()
  const setStatus = useSetPursuitStatus()
  const deletePursuit = useDeletePursuit()
  const removeMember = useRemovePursuitMember()

  // Pull all items / commitments / meetings, then filter to membership.
  // Inefficient but simple — pursuits are small enough that this is fine.
  const { data: allItems } = useItems()
  const { data: allCommitments } = useCommitments()
  const { data: allMeetings } = useMeetings()

  const { itemMembers, commitmentMembers, meetingMembers } = useMemo(() => {
    const itemIds = new Set(
      (members ?? []).filter((m) => m.member_type === 'item').map((m) => m.member_id)
    )
    const commitmentIds = new Set(
      (members ?? []).filter((m) => m.member_type === 'commitment').map((m) => m.member_id)
    )
    const meetingIds = new Set(
      (members ?? []).filter((m) => m.member_type === 'meeting').map((m) => m.member_id)
    )
    return {
      itemMembers: (allItems ?? []).filter((i) => itemIds.has(i.id)),
      commitmentMembers: (allCommitments ?? []).filter((c) => commitmentIds.has(c.id)),
      meetingMembers: (allMeetings ?? []).filter((m) => meetingIds.has(m.id)),
    }
  }, [members, allItems, allCommitments, allMeetings])

  if (isLoading || !pursuit) {
    return <div className="text-gray-400">Loading...</div>
  }

  const handleDelete = () => {
    if (confirm(`Delete pursuit "${pursuit.name}"? This won't delete its members, just the grouping.`)) {
      deletePursuit.mutate(pursuit.id, {
        onSuccess: () => navigate('/pursuits'),
      })
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => navigate('/pursuits')}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"
        >
          <ArrowLeft size={16} /> Back to Pursuits
        </button>
        <button
          onClick={handleDelete}
          className="flex items-center gap-1 rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-red-400"
          title="Delete pursuit"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Pursuit header */}
      <div className="rounded-xl border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <Target size={20} style={{ color: pursuit.color }} />
            <InlineEditable
              as="h1"
              value={pursuit.name}
              onSave={(newName) => updatePursuit.mutate({ id: pursuit.id, name: newName })}
              className="text-xl font-semibold text-white"
              placeholder="Untitled pursuit"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded px-1.5 py-0.5 font-medium uppercase tracking-wider ${
                pursuit.status === 'active'
                  ? 'bg-purple-900/30 text-purple-300'
                  : pursuit.status === 'won'
                    ? 'bg-green-900/30 text-green-300'
                    : pursuit.status === 'lost'
                      ? 'bg-red-900/30 text-red-300'
                      : 'bg-gray-800 text-gray-500'
              }`}
            >
              {pursuit.status}
            </span>
            {pursuit.company && (
              <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-blue-300">
                {pursuit.company}
              </span>
            )}
          </div>
          <div className="mt-2">
            <InlineEditable
              as="p"
              value={pursuit.description ?? ''}
              onSave={(newDesc) => updatePursuit.mutate({ id: pursuit.id, description: newDesc || null })}
              className="text-sm text-gray-400"
              placeholder="Add a description..."
              multiline
            />
          </div>
        </div>

        {/* Status actions */}
        <div className="flex flex-wrap gap-2 border-b border-gray-800 px-6 py-3">
          {pursuit.status === 'active' ? (
            <>
              <button
                onClick={() => setStatus(pursuit.id, 'won')}
                className="flex items-center gap-1.5 rounded bg-green-600/20 px-2.5 py-1 text-xs font-medium text-green-300 hover:bg-green-600/30"
              >
                <Trophy size={12} />
                Mark won
              </button>
              <button
                onClick={() => setStatus(pursuit.id, 'lost')}
                className="flex items-center gap-1.5 rounded bg-gray-800 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-gray-700"
              >
                <Frown size={12} />
                Mark lost
              </button>
              <button
                onClick={() => setStatus(pursuit.id, 'archived')}
                className="flex items-center gap-1.5 rounded bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-400 hover:bg-gray-700"
              >
                <Archive size={12} />
                Archive
              </button>
            </>
          ) : (
            <button
              onClick={() => setStatus(pursuit.id, 'active')}
              className="flex items-center gap-1.5 rounded bg-purple-600/20 px-2.5 py-1 text-xs font-medium text-purple-300 hover:bg-purple-600/30"
            >
              <RotateCcw size={12} />
              Reactivate
            </button>
          )}
        </div>

        {/* Playbook (if pursuit has a template) */}
        {pursuit.template_id && (
          <div className="border-b border-gray-800 px-6 py-4">
            <PlaybookHealth pursuitId={pursuit.id} />
          </div>
        )}

        {/* Tasks */}
        <MemberSection
          title="Tasks"
          icon={<CheckSquare size={14} className="text-gray-400" />}
          count={itemMembers.length}
        >
          {itemMembers.length === 0 ? (
            <EmptyHint>Add items from the item detail page using the "Add to pursuit" button.</EmptyHint>
          ) : (
            <div className="space-y-1.5">
              {itemMembers.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onRemove={() =>
                    removeMember.mutate({
                      pursuitId: pursuit.id,
                      memberType: 'item',
                      memberId: item.id,
                    })
                  }
                />
              ))}
            </div>
          )}
        </MemberSection>

        {/* Commitments */}
        <MemberSection
          title="Commitments"
          icon={<Handshake size={14} className="text-gray-400" />}
          count={commitmentMembers.length}
        >
          {commitmentMembers.length === 0 ? (
            <EmptyHint>Add commitments from /commitments using the "Add to pursuit" button on each row.</EmptyHint>
          ) : (
            <div className="space-y-1.5">
              {commitmentMembers.map((c) => (
                <CommitmentRow
                  key={c.id}
                  commitment={c}
                  onRemove={() =>
                    removeMember.mutate({
                      pursuitId: pursuit.id,
                      memberType: 'commitment',
                      memberId: c.id,
                    })
                  }
                />
              ))}
            </div>
          )}
        </MemberSection>

        {/* Meetings */}
        <MemberSection
          title="Meetings"
          icon={<Calendar size={14} className="text-gray-400" />}
          count={meetingMembers.length}
          last
        >
          {meetingMembers.length === 0 ? (
            <EmptyHint>Add meetings from the meeting detail page using the "Add to pursuit" button.</EmptyHint>
          ) : (
            <div className="space-y-1.5">
              {meetingMembers.map((m) => (
                <MeetingRow
                  key={m.id}
                  meeting={m}
                  onRemove={() =>
                    removeMember.mutate({
                      pursuitId: pursuit.id,
                      memberType: 'meeting',
                      memberId: m.id,
                    })
                  }
                />
              ))}
            </div>
          )}
        </MemberSection>
      </div>
    </div>
  )
}

function MemberSection({
  title,
  icon,
  count,
  last = false,
  children,
}: {
  title: string
  icon: React.ReactNode
  count: number
  last?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={last ? 'px-6 py-4' : 'border-b border-gray-800 px-6 py-4'}>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-300">
        {icon}
        {title} ({count})
      </h3>
      {children}
    </div>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-gray-500">{children}</div>
}

function ItemRow({ item, onRemove }: { item: Item; onRemove: () => void }) {
  const navigate = useNavigate()
  const streamColor = item.streams?.color ?? '#6B7280'
  return (
    <div className={`flex items-center gap-2 rounded-lg border border-gray-800 px-3 py-2 hover:border-gray-700 ${
      item.tracking ? 'bg-gray-950/20 opacity-70' : 'bg-gray-950/50'
    }`}>
      <div className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: streamColor }} />
      <button
        onClick={() => navigate(`/items/${item.id}`)}
        className="flex-1 truncate text-left text-sm text-gray-200 hover:text-white"
      >
        {item.title}
      </button>
      {item.tracking && (
        <span className="flex-shrink-0 rounded bg-blue-900/30 px-1.5 py-0.5 text-[10px] text-blue-300">
          tracking
        </span>
      )}
      <StatusBadge status={item.status} />
      <button
        onClick={onRemove}
        className="text-gray-600 hover:text-red-400"
        title="Remove from pursuit"
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

function CommitmentRow({ commitment, onRemove }: { commitment: Commitment; onRemove: () => void }) {
  return (
    <Link
      to="/commitments"
      className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2 hover:border-gray-700"
    >
      <Handshake size={11} className="flex-shrink-0 text-gray-500" />
      <span className="flex-1 truncate text-sm text-gray-200">{commitment.title}</span>
      {commitment.counterpart && (
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] ${
            commitment.direction === 'incoming'
              ? 'bg-blue-900/30 text-blue-300'
              : 'bg-amber-900/30 text-amber-300'
          }`}
        >
          {commitment.direction === 'incoming' ? 'from' : 'for'} {commitment.counterpart}
        </span>
      )}
      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gray-400">
        {commitment.status}
      </span>
      <button
        onClick={(e) => {
          e.preventDefault()
          onRemove()
        }}
        className="text-gray-600 hover:text-red-400"
        title="Remove from pursuit"
      >
        <Trash2 size={11} />
      </button>
    </Link>
  )
}

function MeetingRow({ meeting, onRemove }: { meeting: Meeting; onRemove: () => void }) {
  return (
    <Link
      to={`/meetings/${meeting.id}`}
      className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2 hover:border-gray-700"
    >
      <Calendar size={11} className="flex-shrink-0 text-gray-500" />
      <span className="flex-1 truncate text-sm text-gray-200">{meeting.title}</span>
      {meeting.start_time && (
        <span className="text-[10px] text-gray-500">
          {new Date(meeting.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      )}
      <ChevronRight size={11} className="text-gray-600" />
      <button
        onClick={(e) => {
          e.preventDefault()
          onRemove()
        }}
        className="text-gray-600 hover:text-red-400"
        title="Remove from pursuit"
      >
        <Trash2 size={11} />
      </button>
    </Link>
  )
}
