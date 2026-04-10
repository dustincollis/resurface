import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BarChart3, TrendingUp, TrendingDown } from 'lucide-react'
import { useProposals } from '../hooks/useProposals'
import type { Proposal, ProposalType, ProposalReviewAction } from '../lib/types'

const TYPE_LABEL: Record<ProposalType, string> = {
  task: 'Tasks',
  commitment: 'Commitments',
  memory: 'Memories',
  draft: 'Drafts',
  deadline_adjustment: 'Deadline adj.',
}

const ACTION_LABEL: Record<ProposalReviewAction, string> = {
  accept: 'Accepted',
  edit: 'Edited',
  merge: 'Merged',
  not_actionable: 'Not actionable',
  dismiss_banter: 'Dismissed (banter)',
}

const ACTION_COLOR: Record<ProposalReviewAction, string> = {
  accept: 'bg-green-500',
  edit: 'bg-blue-500',
  merge: 'bg-purple-500',
  not_actionable: 'bg-yellow-500',
  dismiss_banter: 'bg-gray-500',
}

export default function ProposalAnalytics() {
  const navigate = useNavigate()
  // Fetch all proposals (not just pending)
  const { data: allProposals, isLoading } = useProposals()

  const stats = useMemo(() => {
    const proposals = allProposals ?? []
    const reviewed = proposals.filter((p) => p.status !== 'pending')
    const pending = proposals.filter((p) => p.status === 'pending')

    // By type
    const byType = new Map<ProposalType, Proposal[]>()
    for (const p of reviewed) {
      const list = byType.get(p.proposal_type) ?? []
      list.push(p)
      byType.set(p.proposal_type, list)
    }

    // By review action
    const byAction = new Map<string, number>()
    for (const p of reviewed) {
      if (p.review_action) {
        byAction.set(p.review_action, (byAction.get(p.review_action) ?? 0) + 1)
      }
    }

    // Acceptance rate (accept + edit = "useful")
    const accepted = reviewed.filter((p) => p.review_action === 'accept' || p.review_action === 'edit')
    const rejected = reviewed.filter((p) => p.review_action === 'not_actionable' || p.review_action === 'dismiss_banter')
    const acceptRate = reviewed.length > 0 ? accepted.length / reviewed.length : 0

    // Edit rate (of accepted, how many needed editing?)
    const editRate = accepted.length > 0
      ? accepted.filter((p) => p.review_action === 'edit').length / accepted.length
      : 0

    // By confidence band
    const confBands: { label: string; min: number; max: number; total: number; accepted: number }[] = [
      { label: '90-100%', min: 0.9, max: 1.01, total: 0, accepted: 0 },
      { label: '70-89%', min: 0.7, max: 0.9, total: 0, accepted: 0 },
      { label: '50-69%', min: 0.5, max: 0.7, total: 0, accepted: 0 },
      { label: '<50%', min: 0, max: 0.5, total: 0, accepted: 0 },
      { label: 'No score', min: -1, max: 0, total: 0, accepted: 0 },
    ]
    for (const p of reviewed) {
      const conf = p.confidence ?? -0.5 // null → "no score" band
      for (const band of confBands) {
        if (conf >= band.min && conf < band.max) {
          band.total++
          if (p.review_action === 'accept' || p.review_action === 'edit') band.accepted++
          break
        }
      }
    }

    // Per-type stats
    const typeStats: { type: ProposalType; total: number; accepted: number; edited: number; rejected: number; rate: number }[] = []
    for (const [type, items] of byType) {
      const acc = items.filter((p) => p.review_action === 'accept').length
      const ed = items.filter((p) => p.review_action === 'edit').length
      const rej = items.filter((p) => p.review_action === 'not_actionable' || p.review_action === 'dismiss_banter').length
      typeStats.push({
        type,
        total: items.length,
        accepted: acc,
        edited: ed,
        rejected: rej,
        rate: items.length > 0 ? (acc + ed) / items.length : 0,
      })
    }
    typeStats.sort((a, b) => b.total - a.total)

    // Recent trend: last 20 vs previous 20
    const sorted = [...reviewed].sort((a, b) => new Date(b.reviewed_at ?? b.created_at).getTime() - new Date(a.reviewed_at ?? a.created_at).getTime())
    const recent20 = sorted.slice(0, 20)
    const prev20 = sorted.slice(20, 40)
    const recentRate = recent20.length > 0
      ? recent20.filter((p) => p.review_action === 'accept' || p.review_action === 'edit').length / recent20.length
      : 0
    const prevRate = prev20.length > 0
      ? prev20.filter((p) => p.review_action === 'accept' || p.review_action === 'edit').length / prev20.length
      : 0
    const trend = prev20.length > 0 ? recentRate - prevRate : 0

    return {
      total: proposals.length,
      reviewed: reviewed.length,
      pending: pending.length,
      acceptRate,
      editRate,
      accepted: accepted.length,
      rejected: rejected.length,
      byAction,
      confBands,
      typeStats,
      trend,
      recentRate,
    }
  }, [allProposals])

  if (isLoading) return <div className="text-sm text-gray-500">Loading...</div>

  return (
    <div className="mx-auto max-w-3xl">
      <button
        onClick={() => navigate('/proposals')}
        className="mb-4 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"
      >
        <ArrowLeft size={14} /> Back to Proposals
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-2">
          <BarChart3 size={20} className="text-purple-400" />
          <h1 className="text-2xl font-semibold text-white">Parser Performance</h1>
        </div>
        <p className="mt-1 text-sm text-gray-400">
          {stats.reviewed} proposals reviewed, {stats.pending} pending
        </p>
      </div>

      {stats.reviewed === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 px-6 py-16 text-center">
          <BarChart3 size={32} className="mx-auto text-gray-700" />
          <h2 className="mt-3 text-sm font-medium text-gray-400">No data yet</h2>
          <p className="mt-1 text-xs text-gray-600">
            Review some proposals first. Every accept/edit/reject becomes training data.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Top-line metrics */}
          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              label="Acceptance rate"
              value={`${Math.round(stats.acceptRate * 100)}%`}
              detail={`${stats.accepted} of ${stats.reviewed} useful`}
              trend={stats.trend}
            />
            <MetricCard
              label="Edit rate"
              value={`${Math.round(stats.editRate * 100)}%`}
              detail="of accepted needed edits"
            />
            <MetricCard
              label="Recent trend"
              value={`${Math.round(stats.recentRate * 100)}%`}
              detail="last 20 proposals"
              trend={stats.trend}
            />
          </div>

          {/* By review action — horizontal bar */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500">
              Review outcomes
            </h3>
            <div className="flex h-6 overflow-hidden rounded-full bg-gray-800">
              {(['accept', 'edit', 'merge', 'not_actionable', 'dismiss_banter'] as ProposalReviewAction[]).map((action) => {
                const count = stats.byAction.get(action) ?? 0
                if (count === 0) return null
                const pct = (count / stats.reviewed) * 100
                return (
                  <div
                    key={action}
                    className={`${ACTION_COLOR[action]} flex items-center justify-center text-[10px] font-medium text-white transition-all`}
                    style={{ width: `${pct}%` }}
                    title={`${ACTION_LABEL[action]}: ${count} (${Math.round(pct)}%)`}
                  >
                    {pct > 8 && `${Math.round(pct)}%`}
                  </div>
                )
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-3">
              {(['accept', 'edit', 'merge', 'not_actionable', 'dismiss_banter'] as ProposalReviewAction[]).map((action) => {
                const count = stats.byAction.get(action) ?? 0
                if (count === 0) return null
                return (
                  <div key={action} className="flex items-center gap-1.5 text-xs text-gray-400">
                    <div className={`h-2 w-2 rounded-full ${ACTION_COLOR[action]}`} />
                    {ACTION_LABEL[action]} ({count})
                  </div>
                )
              })}
            </div>
          </div>

          {/* By type */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500">
              By proposal type
            </h3>
            <div className="space-y-3">
              {stats.typeStats.map((ts) => (
                <div key={ts.type}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-300">{TYPE_LABEL[ts.type]}</span>
                    <span className="text-xs text-gray-500">
                      {Math.round(ts.rate * 100)}% useful · {ts.total} total
                    </span>
                  </div>
                  <div className="flex h-3 overflow-hidden rounded-full bg-gray-800">
                    {ts.accepted > 0 && (
                      <div
                        className="bg-green-500"
                        style={{ width: `${(ts.accepted / ts.total) * 100}%` }}
                        title={`Accepted: ${ts.accepted}`}
                      />
                    )}
                    {ts.edited > 0 && (
                      <div
                        className="bg-blue-500"
                        style={{ width: `${(ts.edited / ts.total) * 100}%` }}
                        title={`Edited: ${ts.edited}`}
                      />
                    )}
                    {ts.rejected > 0 && (
                      <div
                        className="bg-gray-600"
                        style={{ width: `${(ts.rejected / ts.total) * 100}%` }}
                        title={`Rejected: ${ts.rejected}`}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* By confidence band */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500">
              Accuracy by confidence band
            </h3>
            <div className="space-y-2">
              {stats.confBands.map((band) => {
                if (band.total === 0) return null
                const rate = band.total > 0 ? band.accepted / band.total : 0
                return (
                  <div key={band.label} className="flex items-center gap-3">
                    <span className="w-16 text-right text-xs text-gray-400">{band.label}</span>
                    <div className="flex-1">
                      <div className="flex h-4 overflow-hidden rounded bg-gray-800">
                        <div
                          className="bg-purple-500 rounded"
                          style={{ width: `${rate * 100}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-20 text-xs text-gray-500">
                      {Math.round(rate * 100)}% ({band.accepted}/{band.total})
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-[11px] text-gray-600">
              Shows what % of proposals in each confidence band you accepted or edited.
              If low-confidence proposals are consistently rejected, consider raising the parser's confidence threshold.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({
  label,
  value,
  detail,
  trend,
}: {
  label: string
  value: string
  detail: string
  trend?: number
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-2xl font-bold text-white">{value}</span>
        {trend !== undefined && trend !== 0 && (
          <span className={`flex items-center gap-0.5 text-xs ${trend > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(Math.round(trend * 100))}%
          </span>
        )}
      </div>
      <div className="mt-0.5 text-xs text-gray-500">{detail}</div>
    </div>
  )
}
