import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Handshake, Calendar, CheckSquare, Flag, AlertTriangle } from 'lucide-react'
import { usePursuits } from '../hooks/usePursuits'
import { useCommitments } from '../hooks/useCommitments'
import { useItems } from '../hooks/useItems'
import { useMeetings } from '../hooks/useMeetings'

interface RiverEvent {
  id: string
  date: Date
  type: 'meeting' | 'commitment' | 'due' | 'milestone'
  title: string
  subtitle?: string
  color: string
  icon: 'meeting' | 'commitment' | 'due' | 'milestone'
  overdue?: boolean
  link?: string
}

function daysFromNow(date: Date): number {
  const now = new Date()
  now.setHours(12, 0, 0, 0)
  const d = new Date(date)
  d.setHours(12, 0, 0, 0)
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function dayLabel(daysAway: number): string {
  if (daysAway === -1) return 'Yesterday'
  if (daysAway === 0) return 'Today'
  if (daysAway === 1) return 'Tomorrow'
  if (daysAway > 0 && daysAway <= 7) {
    const d = new Date()
    d.setDate(d.getDate() + daysAway)
    return d.toLocaleDateString('en-US', { weekday: 'long' })
  }
  const d = new Date()
  d.setDate(d.getDate() + daysAway)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function DashRiver() {
  const navigate = useNavigate()
  const { data: pursuits } = usePursuits({ status: 'active' })
  const { data: commitments } = useCommitments()
  const { data: items } = useItems({ status: ['open', 'in_progress', 'waiting'] })
  const { data: meetings } = useMeetings()

  const events = useMemo(() => {
    const result: RiverEvent[] = []
    const now = new Date()
    const pastLimit = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
    const futureLimit = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

    // Meetings
    for (const m of meetings ?? []) {
      if (!m.start_time) continue
      const d = new Date(m.start_time)
      if (d < pastLimit || d > futureLimit) continue
      result.push({
        id: `m:${m.id}`,
        date: d,
        type: 'meeting',
        title: m.title,
        subtitle: m.attendees?.slice(0, 3).join(', '),
        color: '#60A5FA', // blue
        icon: 'meeting',
        link: `/meetings/${m.id}`,
      })
    }

    // Commitments with due dates
    for (const c of commitments ?? []) {
      if (c.status !== 'open' && c.status !== 'waiting') continue
      if (!c.do_by) continue
      const d = new Date(c.do_by + 'T12:00:00')
      if (d > futureLimit) continue
      if (d < pastLimit && d >= new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)) {
        // Show overdue within last 2 weeks
      } else if (d < pastLimit) continue

      result.push({
        id: `c:${c.id}`,
        date: d,
        type: 'commitment',
        title: c.title,
        subtitle: c.counterpart
          ? `${c.direction === 'outgoing' ? 'You → ' : ''}${c.counterpart}`
          : c.direction === 'outgoing' ? 'You owe' : 'Owed to you',
        color: c.direction === 'outgoing' ? '#FBBF24' : '#60A5FA',
        icon: 'commitment',
        overdue: d < now,
      })
    }

    // Items with due dates
    for (const item of items ?? []) {
      if (!item.due_date || item.tracking) continue
      const d = new Date(item.due_date + 'T12:00:00')
      if (d > futureLimit) continue
      if (d < pastLimit && d >= new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)) {
        // Show overdue
      } else if (d < pastLimit) continue

      result.push({
        id: `i:${item.id}`,
        date: d,
        type: 'due',
        title: item.title,
        subtitle: item.streams?.name ?? undefined,
        color: '#A78BFA', // purple
        icon: 'due',
        overdue: d < now,
        link: `/items/${item.id}`,
      })
    }

    result.sort((a, b) => a.date.getTime() - b.date.getTime())
    return result
  }, [meetings, commitments, items])

  // Group events by day
  const dayGroups = useMemo(() => {
    const groups = new Map<number, RiverEvent[]>()
    for (const e of events) {
      const days = daysFromNow(e.date)
      if (!groups.has(days)) groups.set(days, [])
      groups.get(days)!.push(e)
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0])
  }, [events])

  // Overdue count
  const overdueCount = events.filter((e) => e.overdue).length

  // Pressure: events per day in the next 3 days
  const pressureEvents = events.filter((e) => {
    const d = daysFromNow(e.date)
    return d >= 0 && d <= 2
  })

  // Quiet zones: days with nothing in the next 14 days
  const activeDays = new Set(dayGroups.filter(([d]) => d >= 0).map(([d]) => d))
  const quietDays: number[] = []
  for (let i = 0; i <= 13; i++) {
    if (!activeDays.has(i)) quietDays.push(i)
  }

  const ICON_MAP = {
    meeting: Calendar,
    commitment: Handshake,
    due: CheckSquare,
    milestone: Flag,
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Pressure summary */}
      <div className="mb-4 flex items-center gap-4">
        {overdueCount > 0 && (
          <div className="flex items-center gap-1.5 rounded-lg bg-red-900/20 border border-red-900/40 px-3 py-1.5 text-xs text-red-300">
            <AlertTriangle size={12} />
            {overdueCount} overdue
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className={pressureEvents.length > 6 ? 'text-orange-400 font-medium' : ''}>
            {pressureEvents.length} events in the next 3 days
          </span>
        </div>
        {quietDays.length > 3 && (
          <div className="text-xs text-gray-600">
            {quietDays.length} quiet days ahead
          </div>
        )}
        <div className="ml-auto flex items-center gap-3 text-[10px] text-gray-600">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400" /> Meetings</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-400" /> You owe</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-400" /> Due</span>
        </div>
      </div>

      {/* The River */}
      <div className="relative">
        {/* Flow line */}
        <div className="absolute left-[72px] top-0 bottom-0 w-px bg-gray-800" />

        <div className="space-y-0">
          {dayGroups.map(([daysAway, dayEvents]) => {
            const isToday = daysAway === 0
            const isPast = daysAway < 0
            const label = dayLabel(daysAway)

            return (
              <div key={daysAway} className={`relative ${isPast ? 'opacity-50' : ''}`}>
                {/* Day marker */}
                <div className="flex items-center gap-3 py-2">
                  <div className={`w-[72px] text-right text-xs font-medium ${
                    isToday ? 'text-purple-300' : isPast ? 'text-gray-600' : 'text-gray-500'
                  }`}>
                    {label}
                  </div>
                  <div className={`relative z-10 h-3 w-3 rounded-full border-2 ${
                    isToday
                      ? 'border-purple-400 bg-purple-400 shadow-[0_0_8px_rgba(139,92,246,0.5)]'
                      : isPast
                        ? 'border-gray-700 bg-gray-800'
                        : 'border-gray-600 bg-gray-900'
                  }`} />
                  {isToday && (
                    <div className="text-[10px] font-medium uppercase tracking-wider text-purple-400">
                      now
                    </div>
                  )}
                </div>

                {/* Events for this day */}
                <div className="ml-[84px] space-y-1 pb-2">
                  {dayEvents.map((event) => {
                    const Icon = ICON_MAP[event.icon]
                    return (
                      <button
                        key={event.id}
                        onClick={() => event.link && navigate(event.link)}
                        className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                          event.overdue
                            ? 'border-red-900/50 bg-red-950/20 hover:border-red-800/60'
                            : 'border-gray-800 bg-gray-900 hover:border-gray-700'
                        }`}
                      >
                        <Icon
                          size={14}
                          className="flex-shrink-0"
                          style={{ color: event.overdue ? '#F87171' : event.color }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`truncate text-sm ${event.overdue ? 'text-red-200' : 'text-gray-200'}`}>
                              {event.title}
                            </span>
                            {event.overdue && (
                              <span className="flex-shrink-0 text-[10px] text-red-400">overdue</span>
                            )}
                          </div>
                          {event.subtitle && (
                            <span className="text-xs text-gray-500">{event.subtitle}</span>
                          )}
                        </div>
                        {event.type === 'meeting' && (
                          <span className="flex-shrink-0 text-[10px] text-gray-600">
                            {event.date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Empty state */}
        {dayGroups.length === 0 && (
          <div className="py-16 text-center text-sm text-gray-600">
            Nothing on the river. Clear waters ahead.
          </div>
        )}
      </div>

      {/* Pursuits health strip — bottom */}
      {(pursuits ?? []).length > 0 && (
        <div className="mt-6 rounded-xl border border-gray-800 bg-gray-900 p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-600">
            Active pursuits
          </div>
          <div className="flex flex-wrap gap-2">
            {(pursuits ?? []).map((p) => {
              // Count open commitments for this pursuit
              const pursuitCommitments = (commitments ?? []).filter(
                (c) => c.company === p.company && (c.status === 'open' || c.status === 'waiting')
              )
              return (
                <button
                  key={p.id}
                  onClick={() => navigate(`/pursuits/${p.id}`)}
                  className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2 transition-colors hover:border-gray-700"
                >
                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="text-sm text-gray-200">{p.name}</span>
                  {pursuitCommitments.length > 0 && (
                    <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-300">
                      {pursuitCommitments.length}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
