import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, RefreshCw, AlertCircle, Clock, Mail, AlertTriangle, ListTodo, Users } from 'lucide-react'
import {
  useMorningBriefing,
  useRegenerateMorningBriefing,
} from '../hooks/useMorningBriefing'
import type {
  BriefingMeeting,
  BriefingFollowUp,
  BriefingCommitment,
  BriefingTask,
} from '../lib/types'

// Light theme override. This page is read in the morning, often on a phone.
// Dark mode at 6am is harsh; the rest of the app stays dark, this one breathes.
//
// Layout philosophy: single column, mobile-first, generous spacing, large
// readable type. The user can tap into any item or meeting for details;
// the briefing is the editorial summary that frames the day.

function formatDate(ymd: string): { weekday: string; rest: string } {
  // ymd is YYYY-MM-DD. Add T12:00:00 so date is unambiguous regardless of
  // the browser's timezone interpretation.
  const d = new Date(`${ymd}T12:00:00`)
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' })
  const rest = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  return { weekday, rest }
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function timeRange(start: string | null, end: string | null): string {
  if (!start) return ''
  if (!end) return formatTime(start)
  return `${formatTime(start)} – ${formatTime(end)}`
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default function Morning() {
  const [searchParams] = useSearchParams()
  // ?date=YYYY-MM-DD lets you preview an arbitrary day's briefing.
  // Useful for testing tomorrow before tomorrow happens.
  const rawDate = searchParams.get('date')
  const forDate = rawDate && DATE_RE.test(rawDate) ? rawDate : undefined

  const { data: briefing, isLoading, error } = useMorningBriefing(forDate)
  const regenerate = useRegenerateMorningBriefing(forDate)

  // The page's outer wrapper sets the light theme by overriding the app's
  // global dark background. The rest of the app stays dark; only here.
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <div className="mx-auto max-w-2xl px-5 py-8 sm:py-12">
        {forDate && (
          <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900">
            Previewing briefing for <strong>{forDate}</strong>. Remove <code>?date=</code> from the URL to return to today.
          </div>
        )}
        {isLoading && !briefing && <LoadingState />}
        {error && !briefing && <ErrorState message={(error as Error).message} onRetry={() => regenerate.mutate()} />}
        {briefing && (
          <Briefing
            briefing={briefing}
            onRegenerate={() => regenerate.mutate()}
            regenerating={regenerate.isPending}
          />
        )}
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <Loader2 className="mb-4 h-8 w-8 animate-spin text-stone-400" />
      <p className="text-lg text-stone-600">Generating your morning briefing...</p>
      <p className="mt-2 text-sm text-stone-500">This usually takes 10-15 seconds.</p>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-1 h-5 w-5 flex-shrink-0 text-red-600" />
        <div className="flex-1">
          <h2 className="text-base font-semibold text-red-900">Couldn't generate the briefing</h2>
          <p className="mt-1 text-sm text-red-800">{message}</p>
          <button
            onClick={onRetry}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      </div>
    </div>
  )
}

function Briefing({
  briefing,
  onRegenerate,
  regenerating,
}: {
  briefing: NonNullable<ReturnType<typeof useMorningBriefing>['data']>
  onRegenerate: () => void
  regenerating: boolean
}) {
  const { weekday, rest } = formatDate(briefing.briefing_date)
  const generatedAt = briefing.generated_at
    ? new Date(briefing.generated_at).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null

  return (
    <article>
      {/* Header */}
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
            {weekday}
          </h1>
          <p className="mt-0.5 text-base text-stone-500 sm:text-lg">{rest}</p>
        </div>
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
          title="Regenerate today's briefing"
        >
          {regenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {regenerating ? 'Generating' : 'Refresh'}
        </button>
      </header>

      {/* Status banners */}
      {briefing.status === 'generating' && (
        <div className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Briefing is still generating. Refresh in a moment.
        </div>
      )}
      {briefing.status === 'failed' && (
        <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900">
          Generation failed: {briefing.error_text || 'unknown error'}.{' '}
          <button onClick={onRegenerate} className="underline hover:no-underline">
            Try again
          </button>
        </div>
      )}

      {/* Intro paragraph */}
      {briefing.intro_text && (
        <section className="mb-10">
          <p className="text-lg leading-relaxed text-stone-800 sm:text-xl">
            {briefing.intro_text}
          </p>
        </section>
      )}

      {/* Today's meetings */}
      <Section
        title="Today's meetings"
        icon={<Users size={16} />}
        empty={briefing.meetings_data.length === 0}
        emptyText="Nothing on the calendar today."
      >
        <ul className="space-y-5">
          {briefing.meetings_data.map((m) => (
            <MeetingCard key={m.id} meeting={m} />
          ))}
        </ul>
      </Section>

      {/* Pending follow-ups */}
      <Section
        title="Pending follow-ups"
        icon={<Mail size={16} />}
        empty={briefing.follow_ups_data.length === 0}
        emptyText="No follow-ups pending."
        link={briefing.follow_ups_data.length > 0 ? { to: '/follow-ups', text: 'See all' } : undefined}
      >
        <ul className="space-y-3">
          {briefing.follow_ups_data.slice(0, 6).map((f) => (
            <FollowUpRow key={f.id} item={f} />
          ))}
        </ul>
      </Section>

      {/* Pressing commitments */}
      <Section
        title="Pressing commitments"
        icon={<AlertTriangle size={16} />}
        empty={briefing.commitments_data.length === 0}
        emptyText="No commitments overdue or due today."
        link={briefing.commitments_data.length > 0 ? { to: '/commitments', text: 'See all' } : undefined}
      >
        <ul className="space-y-3">
          {briefing.commitments_data.map((c) => (
            <CommitmentRow key={c.id} item={c} />
          ))}
        </ul>
      </Section>

      {/* Today's task list — top 10 only; rest live on /focus. The
          briefing is meant to be readable in a minute, not a full triage
          surface. */}
      <Section
        title="Today's tasks"
        icon={<ListTodo size={16} />}
        empty={briefing.tasks_data.length === 0}
        emptyText="No urgent tasks surfaced."
        link={briefing.tasks_data.length > 0 ? { to: '/focus', text: 'Open Focus' } : undefined}
      >
        <ul className="space-y-2.5">
          {briefing.tasks_data.slice(0, 10).map((t) => (
            <TaskRow key={t.id} item={t} />
          ))}
        </ul>
        {briefing.tasks_data.length > 10 && (
          <p className="mt-3 text-xs text-stone-500">
            {briefing.tasks_data.length - 10} more on{' '}
            <Link to="/focus" className="underline hover:text-stone-800">Focus</Link>.
          </p>
        )}
      </Section>

      {/* Footer */}
      <footer className="mt-12 border-t border-stone-200 pt-4 text-xs text-stone-400">
        {generatedAt && <span>Snapshot generated at {generatedAt}</span>}
      </footer>
    </article>
  )
}

function Section({
  title,
  icon,
  children,
  empty,
  emptyText,
  link,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  empty: boolean
  emptyText: string
  link?: { to: string; text: string }
}) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-stone-500">
          {icon}
          {title}
        </h2>
        {link && (
          <Link to={link.to} className="text-xs text-stone-500 underline hover:text-stone-800">
            {link.text}
          </Link>
        )}
      </div>
      {empty ? (
        <p className="text-sm italic text-stone-400">{emptyText}</p>
      ) : (
        children
      )}
    </section>
  )
}

function MeetingCard({ meeting }: { meeting: BriefingMeeting }) {
  // Roll up open commitments across attendees so the most actionable thing
  // about this meeting (someone you owe something to, here today) is visible
  // up top instead of buried in per-attendee bullets.
  const allCommitments = meeting.attendee_context.flatMap((a) =>
    a.open_commitments.map((c) => ({ ...c, attendeeName: a.name })),
  )

  return (
    <li className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <Link
          to={`/meetings/${meeting.id}`}
          className="block flex-1 text-base font-semibold text-stone-900 hover:text-blue-700"
        >
          {meeting.title || '(untitled)'}
        </Link>
      </div>
      <div className="mt-1 flex items-center gap-1 text-sm text-stone-500">
        <Clock size={12} />
        {timeRange(meeting.start_time, meeting.end_time) || 'no time'}
      </div>

      {/* Prior-meeting context: when this meeting is preparing for or
          continuing a topic from earlier in the week, surface that. */}
      {meeting.related_prior_meeting?.one_line && (
        <p className="mt-2 rounded bg-stone-100 px-2.5 py-1.5 text-xs italic text-stone-600">
          From <Link
            to={`/meetings/${meeting.related_prior_meeting.id}`}
            className="not-italic font-medium underline hover:text-stone-900"
          >
            {meeting.related_prior_meeting.title || 'prior meeting'}
          </Link>
          : {meeting.related_prior_meeting.one_line}
        </p>
      )}

      {/* Open commitments tied to attendees of this meeting. The most
          actionable surface — a chance to close a loop with someone in
          the room. */}
      {allCommitments.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {allCommitments.slice(0, 4).map((c) => (
            <li key={c.id} className="text-xs text-stone-700">
              <span className={`mr-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                c.direction === 'outgoing'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-blue-100 text-blue-800'
              }`}>
                {c.direction === 'outgoing' ? 'owe' : 'owed'}
              </span>
              {c.title}
              {c.do_by && <span className="text-stone-400"> · {c.do_by}</span>}
            </li>
          ))}
        </ul>
      )}

      {/* Attendees: skip entirely on recurring cadence meetings (the
          attendee list is noise). Two-column layout for everything else
          to keep the card compact. */}
      {!meeting.is_recurring_noise && meeting.attendee_context.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-0.5">
          {meeting.attendee_context.map((a) => (
            <div key={a.name} className="truncate text-xs text-stone-600">
              <span className="text-stone-800">{a.name}</span>
              {a.company && <span className="text-stone-400"> · {a.company}</span>}
            </div>
          ))}
        </div>
      )}
      {meeting.is_recurring_noise && (
        <p className="mt-2 text-xs italic text-stone-400">recurring cadence</p>
      )}
    </li>
  )
}

function FollowUpRow({ item }: { item: BriefingFollowUp }) {
  const ageLabel =
    item.age_days === 0
      ? 'today'
      : item.age_days === 1
        ? 'yesterday'
        : `${item.age_days}d old`
  return (
    <li>
      <Link
        to="/follow-ups"
        className="block rounded-lg border border-stone-200 bg-white p-3 transition-colors hover:bg-stone-100"
      >
        <p className="text-sm font-medium text-stone-900">{item.draft_subject}</p>
        <p className="mt-1 text-xs text-stone-500">
          to {item.recipients.join(', ') || '?'} · {ageLabel}
          {item.source_meeting_title && (
            <span className="text-stone-400"> · from {item.source_meeting_title}</span>
          )}
        </p>
      </Link>
    </li>
  )
}

function CommitmentRow({ item }: { item: BriefingCommitment }) {
  const overdueLabel =
    item.days_overdue > 0
      ? `${item.days_overdue}d overdue`
      : item.do_by
        ? 'due today'
        : ''
  return (
    <li>
      <Link
        to="/commitments"
        className="block rounded-lg border border-stone-200 bg-white p-3 transition-colors hover:bg-stone-100"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="flex-1 text-sm font-medium text-stone-900">{item.title}</p>
          {overdueLabel && (
            <span
              className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${
                item.days_overdue > 0
                  ? 'bg-red-100 text-red-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {overdueLabel}
            </span>
          )}
        </div>
        {(item.counterpart || item.company) && (
          <p className="mt-1 text-xs text-stone-500">
            {item.counterpart && `to ${item.counterpart}`}
            {item.counterpart && item.company && ' · '}
            {item.company && item.company}
          </p>
        )}
      </Link>
    </li>
  )
}

function TaskRow({ item }: { item: BriefingTask }) {
  const reasonStyle: Record<string, string> = {
    overdue: 'bg-red-100 text-red-800',
    'due today': 'bg-amber-100 text-amber-800',
    pinned: 'bg-blue-100 text-blue-800',
    stale: 'bg-yellow-100 text-yellow-800',
    'high stakes': 'bg-orange-100 text-orange-800',
  }
  return (
    <li>
      <Link
        to={`/items/${item.id}`}
        className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 transition-colors hover:bg-stone-100"
      >
        <span className="flex-1 truncate text-sm text-stone-900">{item.title}</span>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
            reasonStyle[item.surface_reason] ?? 'bg-stone-100 text-stone-700'
          }`}
        >
          {item.surface_reason}
        </span>
      </Link>
    </li>
  )
}
