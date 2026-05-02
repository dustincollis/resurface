import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Lightbulb,
  Loader2,
  MapPin,
  Repeat,
  Sparkles,
  Users,
} from 'lucide-react'
import {
  usePreBriefs,
  type PreBrief,
  type SeriesOpenItem,
  type TopicCommitment,
  type TopicItem,
  type TopicMeeting,
} from '../../hooks/usePreBriefs'

function formatMeetingTime(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

function formatShortDate(iso: string | null) {
  if (!iso) return null
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(iso),
  )
}

function attendeeHasContext(attendee: PreBrief['attendee_context'][number]) {
  return (
    attendee.open_commitments.length > 0 ||
    attendee.recent_memories.length > 0 ||
    attendee.prior_meeting_count > 0
  )
}

function briefHasOneOffContent(brief: PreBrief) {
  return Boolean(
    (brief.topic_ideas && brief.topic_ideas.length > 0) ||
      (brief.topic_memories && brief.topic_memories.length > 0) ||
      (brief.topic_commitments && brief.topic_commitments.length > 0) ||
      (brief.similar_meetings && brief.similar_meetings.length > 0),
  )
}

function briefHasContent(brief: PreBrief) {
  if (brief.meeting_kind === 'recurring') {
    return Boolean(brief.series_open_items && brief.series_open_items.length > 0) ||
      brief.attendee_context.some(attendeeHasContext)
  }
  if (brief.meeting_kind === 'large_meeting') {
    return briefHasOneOffContent(brief)
  }
  return briefHasOneOffContent(brief) || brief.attendee_context.some(attendeeHasContext)
}

function ContextLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-2 text-xs text-gray-400">
      <span className="mt-0.5 shrink-0 text-gray-600">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

// Generic helper for rendering a labeled section heading inside a brief.
function SectionHeader({
  icon,
  label,
  hint,
}: {
  icon: ReactNode
  label: string
  hint?: string
}) {
  return (
    <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-gray-500">
      {icon}
      <span>{label}</span>
      {hint && <span className="text-gray-700 normal-case tracking-normal">{hint}</span>}
    </div>
  )
}

// ------------------------------------------------------------
// One-off render branch
// ------------------------------------------------------------

function TopicIdeas({ items }: { items: TopicItem[] }) {
  if (items.length === 0) return null
  return (
    <section>
      <SectionHeader icon={<Lightbulb size={12} />} label="Ideas you've had on this" />
      <div className="space-y-1">
        {items.map((it) => (
          <Link
            key={it.id}
            to="/ideas"
            className="block rounded border border-gray-800 bg-gray-950/45 px-2.5 py-1.5 hover:border-gray-700"
          >
            <div className="flex items-start justify-between gap-2 text-sm">
              <span className="text-gray-200">{it.title}</span>
              <span className="shrink-0 text-[10px] text-gray-600">
                {(it.similarity * 100).toFixed(0)}%
              </span>
            </div>
            {it.snippet && it.snippet !== it.title && (
              <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-gray-500">
                {it.snippet}
              </p>
            )}
          </Link>
        ))}
      </div>
    </section>
  )
}

function TopicMemories({ items }: { items: TopicItem[] }) {
  if (items.length === 0) return null
  return (
    <section>
      <SectionHeader icon={<BriefcaseBusiness size={12} />} label="Things you've heard or noted" />
      <div className="space-y-1">
        {items.map((it) => (
          <div
            key={it.id}
            className="rounded border border-gray-800 bg-gray-950/45 px-2.5 py-1.5"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-gray-300 line-clamp-3 leading-relaxed">{it.snippet}</p>
              <span className="shrink-0 text-[10px] text-gray-600">
                {(it.similarity * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function TopicCommitments({ items }: { items: TopicCommitment[] }) {
  if (items.length === 0) return null
  return (
    <section>
      <SectionHeader icon={<CheckCircle2 size={12} />} label="Open commitments on this" />
      <div className="space-y-1">
        {items.map((c) => {
          const due = formatShortDate(c.do_by)
          return (
            <Link
              key={c.id}
              to="/commitments"
              className="block rounded border border-gray-800 bg-gray-950/45 px-2.5 py-1.5 hover:border-gray-700"
            >
              <div className="flex items-start justify-between gap-2 text-sm">
                <span className="text-gray-200">{c.title}</span>
                <span className="shrink-0 text-[10px] text-gray-600">
                  {(c.similarity * 100).toFixed(0)}%
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500">
                <span className="uppercase tracking-wider">{c.status}</span>
                {due && <span>· due {due}</span>}
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

function SimilarMeetings({ items }: { items: TopicMeeting[] }) {
  if (items.length === 0) return null
  return (
    <section>
      <SectionHeader icon={<CalendarDays size={12} />} label="Past meeting on this" />
      <div className="space-y-1">
        {items.map((m) => {
          const date = formatShortDate(m.start_time)
          return (
            <Link
              key={m.id}
              to={`/meetings/${m.id}`}
              className="block rounded border border-gray-800 bg-gray-950/45 px-2.5 py-1.5 text-sm hover:border-gray-700"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-gray-200">{m.title}</span>
                <span className="shrink-0 text-[10px] text-gray-600">
                  {(m.similarity * 100).toFixed(0)}%
                </span>
              </div>
              {date && <div className="mt-0.5 text-[11px] text-gray-500">{date}</div>}
            </Link>
          )
        })}
      </div>
    </section>
  )
}

function OneOffBrief({ brief }: { brief: PreBrief }) {
  const hasContent = briefHasOneOffContent(brief)

  if (!hasContent && brief.context_status === 'no_embedding') {
    return (
      <div className="rounded-lg border border-dashed border-gray-800 bg-gray-950/40 px-3 py-3 text-xs text-gray-500">
        {brief.context_note}
      </div>
    )
  }

  if (!hasContent) {
    return (
      <div className="rounded-lg border border-dashed border-gray-800 bg-gray-950/40 px-3 py-3 text-xs italic text-gray-500">
        No prior context on this topic — this is a new conversation.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <TopicIdeas items={brief.topic_ideas ?? []} />
      <TopicCommitments items={brief.topic_commitments ?? []} />
      <TopicMemories items={brief.topic_memories ?? []} />
      <SimilarMeetings items={brief.similar_meetings ?? []} />
    </div>
  )
}

// ------------------------------------------------------------
// Recurring render branch — series open items grouped by source meeting
// ------------------------------------------------------------

const SERIES_TYPE_ICON: Record<SeriesOpenItem['source_type'], ReactNode> = {
  commitment: <CheckCircle2 size={11} className="text-amber-400/70" />,
  idea: <Lightbulb size={11} className="text-purple-400/70" />,
  task: <Sparkles size={11} className="text-blue-400/70" />,
}

const SERIES_TYPE_LABEL: Record<SeriesOpenItem['source_type'], string> = {
  commitment: 'commitment',
  idea: 'idea',
  task: 'task',
}

function SeriesOpenItemsBlock({ brief }: { brief: PreBrief }) {
  const items = brief.series_open_items ?? []
  const priorCount = brief.series_prior_instance_count ?? 0

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-800 bg-gray-950/40 px-3 py-3 text-xs italic text-gray-500">
        Nothing still open from the last {priorCount} {priorCount === 1 ? 'instance' : 'instances'} of this meeting.
      </div>
    )
  }

  // Group by source meeting (each prior instance gets its own subhead)
  const byMeeting = new Map<string, { date: string; title: string; entries: SeriesOpenItem[] }>()
  for (const item of items) {
    const existing = byMeeting.get(item.source_meeting_id)
    if (existing) {
      existing.entries.push(item)
    } else {
      byMeeting.set(item.source_meeting_id, {
        date: item.source_meeting_date,
        title: item.source_meeting_title,
        entries: [item],
      })
    }
  }

  const groups = [...byMeeting.entries()].sort(([, a], [, b]) =>
    b.date.localeCompare(a.date),
  )

  return (
    <section>
      <SectionHeader
        icon={<Repeat size={12} />}
        label="Still open from prior instances"
        hint={`${priorCount} prior · this is a recurring meeting`}
      />
      <div className="space-y-3">
        {groups.map(([meetingId, group]) => (
          <div key={meetingId} className="rounded border border-gray-800 bg-gray-950/45 px-2.5 py-2">
            <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
              <Link
                to={`/meetings/${meetingId}`}
                className="truncate text-gray-400 hover:text-gray-200"
                title={group.title}
              >
                {formatShortDate(group.date)}
              </Link>
              <span className="text-gray-700">
                {group.entries.length} item{group.entries.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="space-y-1">
              {group.entries.map((entry) => {
                const due = formatShortDate(entry.do_by)
                const href =
                  entry.source_type === 'commitment'
                    ? '/commitments'
                    : entry.source_type === 'task'
                      ? `/items/${entry.id}`
                      : '/ideas'
                return (
                  <Link
                    key={`${entry.source_type}-${entry.id}`}
                    to={href}
                    className="flex items-center gap-2 text-sm leading-snug text-gray-300 hover:text-white"
                  >
                    {SERIES_TYPE_ICON[entry.source_type]}
                    <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-gray-600">
                      {SERIES_TYPE_LABEL[entry.source_type]}
                    </span>
                    {due && (
                      <span className="shrink-0 text-[10px] text-gray-600">due {due}</span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ------------------------------------------------------------
// Attendee context — applies to both branches, but only when there's
// real signal beyond identity. Self is dropped server-side.
// ------------------------------------------------------------

function AttendeeBlock({ attendee }: { attendee: PreBrief['attendee_context'][number] }) {
  return (
    <div className="rounded border border-gray-800 bg-gray-950/45 p-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-gray-100">{attendee.name}</div>
          {attendee.company_name && (
            <div className="mt-0.5 text-[11px] text-gray-500">
              {attendee.company_id ? (
                <Link to={`/companies/${attendee.company_id}`} className="hover:text-gray-300">
                  {attendee.company_name}
                </Link>
              ) : (
                attendee.company_name
              )}
            </div>
          )}
        </div>
        <Link
          to={`/people/${attendee.person_id}`}
          className="shrink-0 text-[10px] text-purple-400 hover:text-purple-300"
        >
          profile
        </Link>
      </div>

      <div className="mt-2 space-y-1.5">
        {attendee.open_commitments.length > 0 && (
          <ContextLine icon={<CheckCircle2 size={11} />}>
            <div className="space-y-0.5">
              {attendee.open_commitments.slice(0, 3).map((c) => {
                const due = formatShortDate(c.do_by)
                return (
                  <div key={c.id} className="leading-relaxed">
                    <Link to="/commitments" className="text-gray-300 hover:text-white">
                      {c.title}
                    </Link>
                    {due && <span className="text-gray-500"> · due {due}</span>}
                  </div>
                )
              })}
              {attendee.open_commitments.length > 3 && (
                <div className="text-gray-500">
                  +{attendee.open_commitments.length - 3} more open
                </div>
              )}
            </div>
          </ContextLine>
        )}
        {attendee.recent_memories.length > 0 && (
          <ContextLine icon={<BriefcaseBusiness size={11} />}>
            <div className="space-y-0.5">
              {attendee.recent_memories.map((m) => (
                <p key={m.id} className="line-clamp-2 leading-relaxed text-gray-400">
                  {m.content}
                </p>
              ))}
            </div>
          </ContextLine>
        )}
        {attendee.prior_meeting_count > 0 && (
          <ContextLine icon={<Clock size={11} />}>
            <span className="text-gray-500">
              {attendee.prior_meeting_count} prior meeting
              {attendee.prior_meeting_count === 1 ? '' : 's'} in last 60 days
            </span>
          </ContextLine>
        )}
      </div>
    </div>
  )
}

function AttendeesSection({ brief }: { brief: PreBrief }) {
  const visible = brief.attendee_context.filter(attendeeHasContext)
  const totalUnresolved = brief.unresolved_attendee_count
  const droppedNoContext = brief.attendee_context.length - visible.length

  if (visible.length === 0) return null

  return (
    <section>
      <SectionHeader
        icon={<Users size={12} />}
        label="Who's there with context"
        hint={
          totalUnresolved > 0 || droppedNoContext > 0
            ? `+${totalUnresolved + droppedNoContext} other${totalUnresolved + droppedNoContext === 1 ? '' : 's'} without context`
            : undefined
        }
      />
      <div className="grid gap-1.5">
        {visible.map((a) => (
          <AttendeeBlock key={a.person_id} attendee={a} />
        ))}
      </div>
    </section>
  )
}

// ------------------------------------------------------------
// Card shell — meeting metadata + the right body for the kind
// ------------------------------------------------------------

function BriefCard({ brief, defaultOpen }: { brief: PreBrief; defaultOpen: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const isLargeMeeting = brief.meeting_kind === 'large_meeting'
  const isRecurring = brief.meeting_kind === 'recurring'
  const hasContent = briefHasContent(brief)

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-gray-500">
            <span>{formatMeetingTime(brief.meeting.start_time)}</span>
            {isRecurring && (
              <span className="flex items-center gap-1 rounded bg-blue-950/40 px-1.5 py-0.5 text-blue-300">
                <Repeat size={10} /> recurring
              </span>
            )}
            {isLargeMeeting && (
              <span className="flex items-center gap-1 rounded bg-gray-800 px-1.5 py-0.5 text-gray-400">
                <Users size={10} /> {brief.meeting.attendee_count}
              </span>
            )}
          </div>
          <h3 className="mt-0.5 text-base font-semibold leading-snug text-white">
            {brief.meeting.title}
          </h3>
          {brief.meeting.location && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
              <MapPin size={11} />
              <span className="truncate">{brief.meeting.location}</span>
            </div>
          )}
        </div>
        <span className="mt-1 shrink-0 text-gray-600">
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>

      {isOpen && (
        <div className="mt-4 space-y-4">
          {brief.context_note && (
            <div className="flex items-start gap-2 rounded border border-gray-800 bg-gray-950/45 px-3 py-2 text-xs text-gray-400">
              <AlertCircle size={12} className="mt-0.5 shrink-0 text-gray-600" />
              <span>{brief.context_note}</span>
            </div>
          )}
          {isRecurring ? (
            <SeriesOpenItemsBlock brief={brief} />
          ) : (
            <OneOffBrief brief={brief} />
          )}
          <AttendeesSection brief={brief} />
          {!hasContent && !brief.context_note && (
            <p className="text-xs italic text-gray-600">
              No prior context — this is a new conversation.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

export default function PreBriefs() {
  const { data: briefs, isLoading, error } = usePreBriefs()

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-white">
          <CalendarDays size={20} className="text-purple-400" />
          Pre-Briefs
        </h1>
        <p className="mt-1 text-xs text-gray-500">
          Context for your next 7 days of meetings — what you've thought, said, and promised
          on each topic.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin" />
          Loading meetings...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {(error as Error).message}
        </div>
      )}

      {briefs && briefs.length === 0 && (
        <p className="text-sm text-gray-500">No upcoming meetings in the next 7 days.</p>
      )}

      {briefs && briefs.length > 0 && (
        <div className="space-y-3">
          {briefs.map((brief, i) => (
            <BriefCard
              key={brief.meeting.id}
              brief={brief}
              defaultOpen={i === 0 && briefHasContent(brief)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
