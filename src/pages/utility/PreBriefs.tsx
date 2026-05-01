import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  Lightbulb,
  Loader2,
  MapPin,
  Users,
} from 'lucide-react'
import { usePreBriefs, type PreBrief } from '../../hooks/usePreBriefs'

function formatMeetingTime(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

function formatDate(iso: string | null) {
  if (!iso) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso))
}

function attendeeHasContext(attendee: PreBrief['attendees'][number]) {
  return (
    attendee.open_commitments.length > 0 ||
    attendee.recent_memories.length > 0 ||
    attendee.recent_ideas.length > 0 ||
    attendee.prior_meetings.length > 0
  )
}

function briefHasContext(brief: PreBrief) {
  if (brief.context_status === 'skipped_large_meeting') return true
  const hasAttendeeContext = brief.attendees.some(attendeeHasContext)
  const hasCompanyContext = Boolean(
    brief.primary_company &&
      (brief.primary_company.open_company_ideas.length > 0 ||
        brief.primary_company.open_company_commitments.length > 0),
  )
  return hasAttendeeContext || hasCompanyContext
}

function ContextLine({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex gap-2 text-xs text-gray-400">
      <span className="mt-0.5 shrink-0 text-gray-600">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function AttendeeBlock({ attendee }: { attendee: PreBrief['attendees'][number] }) {
  const company = attendee.company_name

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/45 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-gray-100">{attendee.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
            {company && attendee.company_id && (
              <Link to={`/companies/${attendee.company_id}`} className="hover:text-gray-300">
                {company}
              </Link>
            )}
            {!attendee.person_id && <span>name only</span>}
            {attendee.raw !== attendee.name && <span className="truncate">{attendee.raw}</span>}
          </div>
        </div>
        {attendee.person_id && (
          <Link
            to={`/people/${attendee.person_id}`}
            className="shrink-0 text-[11px] text-purple-400 hover:text-purple-300"
          >
            profile
          </Link>
        )}
      </div>

      {attendeeHasContext(attendee) ? (
        <div className="mt-3 space-y-2">
          {attendee.open_commitments.length > 0 && (
            <ContextLine icon={<CheckCircle2 size={13} />}>
              <div className="space-y-1">
                {attendee.open_commitments.slice(0, 3).map((commitment) => {
                  const due = formatDate(commitment.do_by)
                  return (
                    <div key={commitment.id} className="leading-relaxed">
                      <Link to="/commitments" className="text-gray-300 hover:text-white">
                        {commitment.title}
                      </Link>
                      {due && <span className="text-gray-500"> due {due}</span>}
                    </div>
                  )
                })}
                {attendee.open_commitments.length > 3 && (
                  <div className="text-gray-500">
                    {attendee.open_commitments.length - 3} more open commitments
                  </div>
                )}
              </div>
            </ContextLine>
          )}

          {attendee.recent_memories.length > 0 && (
            <ContextLine icon={<BriefcaseBusiness size={13} />}>
              <div className="space-y-1">
                {attendee.recent_memories.slice(0, 2).map((memory) => (
                  <p key={memory.id} className="line-clamp-2 leading-relaxed text-gray-300">
                    {memory.content}
                  </p>
                ))}
              </div>
            </ContextLine>
          )}

          {attendee.recent_ideas.length > 0 && (
            <ContextLine icon={<Lightbulb size={13} />}>
              <div className="space-y-1">
                {attendee.recent_ideas.map((idea) => (
                  <Link
                    key={idea.id}
                    to="/ideas"
                    className="block truncate text-gray-300 hover:text-white"
                  >
                    {idea.title}
                  </Link>
                ))}
              </div>
            </ContextLine>
          )}

          {attendee.prior_meetings.length > 0 && (
            <ContextLine icon={<Clock size={13} />}>
              <div className="space-y-1">
                {attendee.prior_meetings.slice(0, 3).map((meeting) => (
                  <Link
                    key={meeting.id}
                    to={`/meetings/${meeting.id}`}
                    className="block truncate text-gray-300 hover:text-white"
                  >
                    {meeting.title}
                    <span className="text-gray-500"> - {formatDate(meeting.start_time)}</span>
                  </Link>
                ))}
                {attendee.prior_meetings.length > 3 && (
                  <div className="text-gray-500">
                    {attendee.prior_meetings.length} prior meetings total
                  </div>
                )}
              </div>
            </ContextLine>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs italic text-gray-600">no prior context</p>
      )}
    </div>
  )
}

function CompanyContext({ company }: { company: NonNullable<PreBrief['primary_company']> }) {
  const hasContext =
    company.open_company_ideas.length > 0 || company.open_company_commitments.length > 0

  if (!hasContext) return null

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/45 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
        <Building2 size={13} />
        <Link to={`/companies/${company.id}`} className="hover:text-gray-300">
          {company.name}
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {company.open_company_commitments.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wider text-gray-600">
              Open commitments
            </div>
            <div className="space-y-1">
              {company.open_company_commitments.map((commitment) => (
                <Link
                  key={commitment.id}
                  to="/commitments"
                  className="block truncate text-xs text-gray-300 hover:text-white"
                >
                  {commitment.title}
                </Link>
              ))}
            </div>
          </div>
        )}
        {company.open_company_ideas.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wider text-gray-600">
              Surfaced ideas
            </div>
            <div className="space-y-1">
              {company.open_company_ideas.map((idea) => (
                <Link
                  key={idea.id}
                  to="/ideas"
                  className="block truncate text-xs text-gray-300 hover:text-white"
                >
                  {idea.title}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PreBriefCard({
  brief,
  expanded,
  onToggle,
}: {
  brief: PreBrief
  expanded: boolean
  onToggle: () => void
}) {
  const attendeeCount = brief.meeting.attendee_count ?? brief.meeting.attendees_raw.length
  const isLargeMeeting = brief.context_status === 'skipped_large_meeting'
  const isCollapsible = attendeeCount > 5
  const isCollapsed = isCollapsible && !expanded

  return (
    <article className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={13} />
              {formatMeetingTime(brief.meeting.start_time)}
            </span>
            {brief.meeting.location && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin size={13} />
                <span className="truncate">{brief.meeting.location}</span>
              </span>
            )}
          </div>
          <Link
            to={`/meetings/${brief.meeting.id}`}
            className="block truncate text-lg font-semibold text-white hover:text-purple-300"
          >
            {brief.meeting.title || '(untitled meeting)'}
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="inline-flex items-center gap-1 text-xs text-gray-500">
            <Users size={13} />
            {attendeeCount}
          </div>
          {isCollapsible && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!isCollapsed}
              className="inline-flex items-center gap-1 rounded border border-gray-800 px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
            >
              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              {isCollapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
        </div>
      </div>

      {isCollapsed && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-4 flex w-full items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/45 px-3 py-2 text-left text-xs text-gray-500 hover:border-gray-700 hover:text-gray-300"
        >
          <span>
            {isLargeMeeting
              ? 'Large meeting - attendee context skipped'
              : `${attendeeCount} attendees - expand for attendee context`}
          </span>
          <ChevronRight size={13} className="shrink-0" />
        </button>
      )}

      {!isCollapsed && isLargeMeeting && (
        <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950/45 px-3 py-2">
          <div className="flex gap-2 text-xs text-gray-400">
            <Users size={13} className="mt-0.5 shrink-0 text-gray-600" />
            <div>
              <div className="font-medium text-gray-300">Large meeting</div>
              <div className="mt-0.5 text-gray-500">
                {brief.context_note ?? 'Attendee context skipped for this meeting.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {!isCollapsed && !briefHasContext(brief) && (
        <p className="mt-4 rounded-lg border border-dashed border-gray-800 px-3 py-2 text-xs italic text-gray-600">
          no prior context
        </p>
      )}

      {!isCollapsed && brief.primary_company && (
        <div className="mt-4">
          <CompanyContext company={brief.primary_company} />
        </div>
      )}

      {!isCollapsed && !isLargeMeeting && (
        <div className="mt-4 grid gap-3">
          {brief.attendees.length > 0 ? (
            brief.attendees.map((attendee) => (
              <AttendeeBlock key={`${brief.meeting.id}:${attendee.raw}`} attendee={attendee} />
            ))
          ) : (
            <p className="text-sm text-gray-600">No attendees on the invite.</p>
          )}
        </div>
      )}
    </article>
  )
}

export default function PreBriefs() {
  const { data: briefs, isLoading, error, refetch, isFetching } = usePreBriefs()
  const [expandedBriefIds, setExpandedBriefIds] = useState<Set<string>>(() => new Set())

  function toggleBrief(id: string) {
    setExpandedBriefIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Pre-Briefs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Upcoming meetings with the context already in Resurface.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-lg border border-gray-800 px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading pre-briefs...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <AlertCircle size={16} />
            Pre-briefs failed
          </div>
          <p className="text-red-200/80">{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      )}

      {!isLoading && !error && briefs?.length === 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-500">
          No meetings in the next 7 days.
        </div>
      )}

      {!isLoading && !error && briefs && briefs.length > 0 && (
        <div className="space-y-4">
          {briefs.map((brief) => (
            <PreBriefCard
              key={brief.meeting.id}
              brief={brief}
              expanded={expandedBriefIds.has(brief.meeting.id)}
              onToggle={() => toggleBrief(brief.meeting.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
