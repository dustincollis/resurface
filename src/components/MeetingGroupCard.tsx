import { Link, useNavigate } from 'react-router-dom'
import { Pin, FolderTree } from 'lucide-react'
import type { Item } from '../lib/types'
import { formatDueLabel } from '../lib/priorityScore'

// MeetingGroupCard — renders a single card containing multiple tasks
// that all came from the same meeting. Used on /focus when 2+ active
// items share a source_meeting_id, so related work doesn't get
// scattered across the priority list.
//
// Card shape:
//   ┌───────────────────────────────────────────────┐
//   │ #N · From [Meeting title]    3 active · 1 done │  ← header strip
//   ├───────────────────────────────────────────────┤
//   │  ● Title 1                       Tue          │
//   │  ● Title 2                       overdue       │
//   │  ● Title 3                                     │
//   │  ● ~~Title 4~~ (grayed)          done          │
//   └───────────────────────────────────────────────┘
//
// Done items are shown grayed out so the user can see what's been
// completed in this group's context — easier to gauge progress at a
// glance than separating them.

interface MeetingInfo {
  id: string
  title: string | null
}

interface Props {
  meeting: MeetingInfo
  items: Item[]
  rank: number
}

export default function MeetingGroupCard({ meeting, items, rank }: Props) {
  const active = items.filter((i) => i.status !== 'done' && i.status !== 'dropped')
  const done = items.filter((i) => i.status === 'done')

  return (
    <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
      {/* Meeting header strip — clickable to the meeting itself */}
      <Link
        to={`/meetings/${meeting.id}`}
        className="block border-b border-gray-800 bg-gray-950/40 px-5 py-2.5 transition-colors hover:bg-gray-900"
      >
        <div className="flex items-center gap-2 text-xs">
          {rank > 0 && (
            <span className="font-medium text-gray-600">{rank}</span>
          )}
          <FolderTree size={11} className="text-gray-600" />
          <span className="text-[10px] uppercase tracking-wider text-gray-500">
            From
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-gray-300">
            {meeting.title || '(untitled meeting)'}
          </span>
          <span className="flex-shrink-0 text-gray-600">
            {active.length} active{done.length > 0 ? ` · ${done.length} done` : ''}
          </span>
        </div>
      </Link>

      {/* Item rows — active first, then done (grayed) */}
      <ul className="divide-y divide-gray-800/60">
        {active.map((item) => (
          <GroupedItemRow key={item.id} item={item} />
        ))}
        {done.map((item) => (
          <GroupedItemRow key={item.id} item={item} done />
        ))}
      </ul>
    </div>
  )
}

function GroupedItemRow({ item, done }: { item: Item; done?: boolean }) {
  const navigate = useNavigate()
  const dueLabel = item.due_date ? formatDueLabel(item.due_date) : null
  const streamColor = item.streams?.color ?? '#6B7280'

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/items/${item.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/items/${item.id}`)
        }
      }}
      className={`flex cursor-pointer items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-gray-800/30 ${
        done ? 'opacity-60' : ''
      }`}
    >
      {item.pinned ? (
        <Pin size={11} className="flex-shrink-0 text-yellow-400" />
      ) : (
        <span
          className="h-2 w-2 flex-shrink-0 rounded-full"
          style={{ backgroundColor: streamColor }}
        />
      )}
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          done ? 'text-gray-500 line-through' : 'text-gray-200'
        }`}
      >
        {item.title}
      </span>
      {item.streams && (
        <span className="hidden flex-shrink-0 text-xs text-gray-600 sm:inline">
          {item.streams.name}
        </span>
      )}
      {dueLabel && !done && (
        <span
          className={`flex-shrink-0 text-xs ${
            dueLabel.tone === 'red'
              ? 'font-medium text-red-400'
              : dueLabel.tone === 'orange'
                ? 'font-medium text-orange-400'
                : 'text-gray-500'
          }`}
        >
          {dueLabel.text}
        </span>
      )}
      {done && (
        <span className="flex-shrink-0 text-xs text-gray-600">done</span>
      )}
    </li>
  )
}
