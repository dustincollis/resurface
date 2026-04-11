import { useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Flag, Target, Handshake, CheckSquare, Calendar, AlertTriangle,
  ChevronRight, Clock, ArrowRight,
} from 'lucide-react'
import { useGoals } from '../hooks/useGoals'
import { usePursuits } from '../hooks/usePursuits'
import { useCommitments } from '../hooks/useCommitments'
import { useItems } from '../hooks/useItems'
import { useMeetings } from '../hooks/useMeetings'
import { useProposals } from '../hooks/useProposals'
import type { Goal, Commitment } from '../lib/types'

export default function Dashboard() {
  const navigate = useNavigate()
  const { data: goals } = useGoals('active')
  const { data: pursuits } = usePursuits({ status: 'active' })
  const { data: allCommitments } = useCommitments()
  const { data: activeItems } = useItems({ status: ['open', 'in_progress', 'waiting'] })
  const { data: meetings } = useMeetings()
  const { data: pendingProposals } = useProposals({ status: 'pending' })

  const openCommitments = useMemo(
    () => (allCommitments ?? []).filter((c) => c.status === 'open' || c.status === 'waiting'),
    [allCommitments]
  )

  const overdueCommitments = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return openCommitments.filter((c) => c.do_by && c.do_by < today)
  }, [openCommitments])

  const youOwe = useMemo(
    () => openCommitments.filter((c) => c.direction === 'outgoing'),
    [openCommitments]
  )

  const theyOwe = useMemo(
    () => openCommitments.filter((c) => c.direction === 'incoming'),
    [openCommitments]
  )

  // Upcoming meetings (next 7 days)
  const upcomingMeetings = useMemo(() => {
    const now = new Date()
    const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    return (meetings ?? [])
      .filter((m) => {
        if (!m.start_time) return false
        const d = new Date(m.start_time)
        return d >= now && d <= weekOut
      })
      .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime())
      .slice(0, 5)
  }, [meetings])

  // Stale items (not touched in 3+ days)
  const staleItems = useMemo(() => {
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000
    return (activeItems ?? [])
      .filter((i) => !i.tracking && new Date(i.last_touched_at).getTime() < threeDaysAgo)
      .sort((a, b) => new Date(a.last_touched_at).getTime() - new Date(b.last_touched_at).getTime())
      .slice(0, 5)
  }, [activeItems])

  const nonTrackingItems = (activeItems ?? []).filter((i) => !i.tracking)

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <Link
          to="/focus"
          className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500"
        >
          <Target size={14} />
          Focus Mode
        </Link>
      </div>

      {/* Top stat cards */}
      <div className="mb-6 grid grid-cols-4 gap-3">
        <StatCard
          icon={<CheckSquare size={16} className="text-blue-400" />}
          label="Active tasks"
          value={nonTrackingItems.length}
          onClick={() => navigate('/focus')}
        />
        <StatCard
          icon={<Handshake size={16} className="text-amber-400" />}
          label="Open commitments"
          value={openCommitments.length}
          alert={overdueCommitments.length > 0 ? `${overdueCommitments.length} overdue` : undefined}
          onClick={() => navigate('/commitments')}
        />
        <StatCard
          icon={<Target size={16} className="text-purple-400" />}
          label="Active pursuits"
          value={(pursuits ?? []).length}
          onClick={() => navigate('/pursuits')}
        />
        <StatCard
          icon={<Flag size={16} className="text-purple-400" />}
          label="Active goals"
          value={(goals ?? []).length}
          onClick={() => navigate('/goals')}
        />
      </div>

      {/* Proposals alert */}
      {(pendingProposals ?? []).length > 0 && (
        <Link
          to="/proposals"
          className="mb-6 flex items-center gap-3 rounded-xl border border-purple-800/40 bg-purple-950/20 px-4 py-3 transition-colors hover:border-purple-700/60"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-600 text-sm font-bold text-white">
            {(pendingProposals ?? []).length}
          </div>
          <div className="flex-1">
            <span className="text-sm font-medium text-purple-200">
              {(pendingProposals ?? []).length} proposal{(pendingProposals ?? []).length !== 1 ? 's' : ''} awaiting review
            </span>
            <p className="text-xs text-purple-300/60">From recent meetings and transcripts</p>
          </div>
          <ArrowRight size={16} className="text-purple-400" />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Goals progress */}
          {(goals ?? []).length > 0 && (
            <Section title="Goals" icon={<Flag size={14} />} linkTo="/goals">
              <div className="space-y-2">
                {(goals ?? []).map((g) => (
                  <GoalRow key={g.id} goal={g} onClick={() => navigate(`/goals/${g.id}`)} />
                ))}
              </div>
            </Section>
          )}

          {/* Commitments you owe */}
          <Section
            title={`You owe (${youOwe.length})`}
            icon={<Handshake size={14} />}
            linkTo="/commitments"
          >
            {youOwe.length === 0 ? (
              <div className="text-xs text-gray-600">All clear</div>
            ) : (
              <div className="space-y-1">
                {youOwe.slice(0, 5).map((c) => (
                  <CommitmentRow key={c.id} commitment={c} />
                ))}
                {youOwe.length > 5 && (
                  <div className="text-xs text-gray-600">+{youOwe.length - 5} more</div>
                )}
              </div>
            )}
          </Section>

          {/* Commitments they owe */}
          <Section
            title={`Owed to you (${theyOwe.length})`}
            icon={<Handshake size={14} />}
            linkTo="/commitments"
          >
            {theyOwe.length === 0 ? (
              <div className="text-xs text-gray-600">Nothing pending</div>
            ) : (
              <div className="space-y-1">
                {theyOwe.slice(0, 5).map((c) => (
                  <CommitmentRow key={c.id} commitment={c} />
                ))}
                {theyOwe.length > 5 && (
                  <div className="text-xs text-gray-600">+{theyOwe.length - 5} more</div>
                )}
              </div>
            )}
          </Section>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Active pursuits */}
          {(pursuits ?? []).length > 0 && (
            <Section title="Pursuits" icon={<Target size={14} />} linkTo="/pursuits">
              <div className="space-y-1">
                {(pursuits ?? []).slice(0, 8).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => navigate(`/pursuits/${p.id}`)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-800/50"
                  >
                    <div className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                    <span className="flex-1 truncate text-sm text-gray-200">{p.name}</span>
                    {p.company && (
                      <span className="text-[10px] text-gray-500">{p.company}</span>
                    )}
                    <ChevronRight size={12} className="text-gray-600" />
                  </button>
                ))}
              </div>
            </Section>
          )}

          {/* Upcoming meetings */}
          {upcomingMeetings.length > 0 && (
            <Section title="Upcoming" icon={<Calendar size={14} />} linkTo="/meetings">
              <div className="space-y-1">
                {upcomingMeetings.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => navigate(`/meetings/${m.id}`)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-800/50"
                  >
                    <span className="flex-1 truncate text-sm text-gray-200">{m.title}</span>
                    <span className="text-[10px] text-gray-500">
                      {new Date(m.start_time!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                  </button>
                ))}
              </div>
            </Section>
          )}

          {/* Stale items */}
          {staleItems.length > 0 && (
            <Section title="Going stale" icon={<AlertTriangle size={14} className="text-yellow-500" />} linkTo="/focus">
              <div className="space-y-1">
                {staleItems.map((item) => {
                  const daysSince = Math.floor((Date.now() - new Date(item.last_touched_at).getTime()) / (1000 * 60 * 60 * 24))
                  return (
                    <button
                      key={item.id}
                      onClick={() => navigate(`/items/${item.id}`)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-800/50"
                    >
                      <Clock size={12} className="flex-shrink-0 text-yellow-500/60" />
                      <span className="flex-1 truncate text-sm text-gray-300">{item.title}</span>
                      <span className="text-[10px] text-gray-500">{daysSince}d</span>
                    </button>
                  )
                })}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  alert,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value: number
  alert?: string
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-left transition-colors hover:border-gray-700"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
      {alert && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-red-400">
          <AlertTriangle size={10} />
          {alert}
        </div>
      )}
    </button>
  )
}

function Section({
  title,
  icon,
  linkTo,
  children,
}: {
  title: string
  icon: React.ReactNode
  linkTo: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          {icon}
          {title}
        </div>
        <Link to={linkTo} className="text-[10px] text-gray-600 hover:text-gray-400">
          View all
        </Link>
      </div>
      {children}
    </div>
  )
}

function GoalRow({ goal, onClick }: { goal: Goal; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-gray-800/50"
    >
      <Flag size={14} className="flex-shrink-0 text-purple-400" />
      <span className="flex-1 truncate text-sm text-gray-200">{goal.name}</span>
      <ChevronRight size={12} className="text-gray-600" />
    </button>
  )
}

function CommitmentRow({ commitment }: { commitment: Commitment }) {
  const navigate = useNavigate()
  const isOverdue = commitment.do_by && commitment.do_by < new Date().toISOString().slice(0, 10)

  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-800/50 cursor-pointer"
      onClick={() => navigate('/commitments')}
    >
      <div className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${isOverdue ? 'bg-red-400' : 'bg-amber-400/60'}`} />
      <span className="flex-1 truncate text-sm text-gray-300">{commitment.title}</span>
      {commitment.counterpart && (
        <span className="text-[10px] text-gray-500">{commitment.counterpart}</span>
      )}
      {commitment.do_by && (
        <span className={`text-[10px] ${isOverdue ? 'font-medium text-red-400' : 'text-gray-500'}`}>
          {new Date(commitment.do_by + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      )}
    </div>
  )
}
