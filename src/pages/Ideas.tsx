import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Lightbulb, Search, Eye, Check, X, Archive, ChevronDown, ChevronRight, Calendar, User, Building2 } from 'lucide-react'
import { useIdeas, useUpdateIdeaStatus, usePromoteIdeaToGoal, usePromoteIdeaToPursuit } from '../hooks/useIdeas'
import { useGoals } from '../hooks/useGoals'
import { usePursuits } from '../hooks/usePursuits'
import type { Idea, IdeaStatus, IdeaCategory } from '../lib/types'

const STATUS_LABEL: Record<IdeaStatus, string> = {
  surfaced: 'Surfaced',
  exploring: 'Exploring',
  accepted: 'Accepted',
  dismissed: 'Dismissed',
  archived: 'Archived',
}

const STATUS_STYLE: Record<IdeaStatus, string> = {
  surfaced: 'bg-amber-900/30 text-amber-300',
  exploring: 'bg-blue-900/30 text-blue-300',
  accepted: 'bg-green-900/30 text-green-300',
  dismissed: 'bg-gray-800 text-gray-500',
  archived: 'bg-gray-800 text-gray-500',
}

const CATEGORY_LABEL: Record<IdeaCategory, string> = {
  gtm_motion: 'GTM Motion',
  selling_approach: 'Selling Approach',
  partnership: 'Partnership',
  positioning: 'Positioning',
  campaign: 'Campaign',
  bundling: 'Bundling',
  product: 'Product',
  process: 'Process',
  other: 'Other',
}

const CATEGORY_STYLE: Record<IdeaCategory, string> = {
  gtm_motion: 'bg-purple-900/30 text-purple-300',
  selling_approach: 'bg-cyan-900/30 text-cyan-300',
  partnership: 'bg-indigo-900/30 text-indigo-300',
  positioning: 'bg-orange-900/30 text-orange-300',
  campaign: 'bg-pink-900/30 text-pink-300',
  bundling: 'bg-teal-900/30 text-teal-300',
  product: 'bg-emerald-900/30 text-emerald-300',
  process: 'bg-yellow-900/30 text-yellow-300',
  other: 'bg-gray-800 text-gray-400',
}

type ViewMode = 'status' | 'category'
type StatusFilter = 'active' | 'all' | IdeaStatus

export default function Ideas() {
  const { data: ideas, isLoading } = useIdeas()
  const [viewMode, setViewMode] = useState<ViewMode>('status')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [categoryFilter, setCategoryFilter] = useState<IdeaCategory | ''>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!ideas) return []
    let result = ideas

    // Status filter
    if (statusFilter === 'active') {
      result = result.filter((i) => i.status === 'surfaced' || i.status === 'exploring')
    } else if (statusFilter !== 'all') {
      result = result.filter((i) => i.status === statusFilter)
    }

    // Category filter
    if (categoryFilter) {
      result = result.filter((i) => i.category === categoryFilter)
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.description?.toLowerCase().includes(q) ||
          i.company_name?.toLowerCase().includes(q) ||
          i.originated_by?.toLowerCase().includes(q)
      )
    }

    return result
  }, [ideas, statusFilter, categoryFilter, searchQuery])

  const counts = useMemo(() => {
    const c: Record<string, number> = { surfaced: 0, exploring: 0, accepted: 0, dismissed: 0, archived: 0 }
    for (const i of ideas ?? []) c[i.status] = (c[i.status] || 0) + 1
    return c
  }, [ideas])

  const grouped = useMemo(() => {
    if (viewMode === 'status') {
      const groups: Record<string, Idea[]> = {}
      for (const i of filtered) {
        const key = i.status
        if (!groups[key]) groups[key] = []
        groups[key].push(i)
      }
      return groups
    } else {
      const groups: Record<string, Idea[]> = {}
      for (const i of filtered) {
        const key = i.category || 'other'
        if (!groups[key]) groups[key] = []
        groups[key].push(i)
      }
      return groups
    }
  }, [filtered, viewMode])

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Ideas</h1>
          <p className="mt-1 text-sm text-gray-400">
            Strategic concepts surfaced from meetings. Explore, promote to goals or pursuits, or dismiss.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {counts.surfaced > 0 && (
            <span className="rounded-full bg-amber-900/30 px-3 py-1 text-xs text-amber-300">
              {counts.surfaced} new
            </span>
          )}
          {counts.exploring > 0 && (
            <span className="rounded-full bg-blue-900/30 px-3 py-1 text-xs text-blue-300">
              {counts.exploring} exploring
            </span>
          )}
        </div>
      </div>

      {/* Filters bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-2 text-gray-500" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search ideas..."
            className="w-full rounded-lg border border-gray-800 bg-gray-900 py-1.5 pl-8 pr-3 text-sm text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-lg border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs text-gray-300 focus:border-gray-600 focus:outline-none"
        >
          <option value="active">Active (surfaced + exploring)</option>
          <option value="all">All statuses</option>
          <option value="surfaced">Surfaced</option>
          <option value="exploring">Exploring</option>
          <option value="accepted">Accepted</option>
          <option value="dismissed">Dismissed</option>
          <option value="archived">Archived</option>
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as IdeaCategory | '')}
          className="rounded-lg border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs text-gray-300 focus:border-gray-600 focus:outline-none"
        >
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <div className="flex rounded-lg border border-gray-800">
          <button
            onClick={() => setViewMode('status')}
            className={`px-2.5 py-1.5 text-xs ${viewMode === 'status' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}
          >
            By status
          </button>
          <button
            onClick={() => setViewMode('category')}
            className={`px-2.5 py-1.5 text-xs ${viewMode === 'category' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}
          >
            By category
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 px-6 py-16 text-center">
          <Lightbulb size={32} className="mx-auto text-gray-700" />
          <h2 className="mt-3 text-sm font-medium text-gray-400">
            {(ideas?.length ?? 0) === 0 ? 'No ideas yet' : 'No ideas match your filters'}
          </h2>
          <p className="mt-1 text-xs text-gray-600">
            {(ideas?.length ?? 0) === 0
              ? 'Ideas are extracted from meeting transcripts during AI parsing.'
              : 'Try broadening your filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([key, items]) => (
            <IdeaSection
              key={key}
              title={viewMode === 'status' ? STATUS_LABEL[key as IdeaStatus] || key : CATEGORY_LABEL[key as IdeaCategory] || key}
              ideas={items}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
              dim={key === 'dismissed' || key === 'archived'}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function IdeaSection({
  title,
  ideas,
  expandedId,
  onToggle,
  dim = false,
}: {
  title: string
  ideas: Idea[]
  expandedId: string | null
  onToggle: (id: string) => void
  dim?: boolean
}) {
  return (
    <section className={dim ? 'opacity-60' : ''}>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
        {title} ({ideas.length})
      </h2>
      <div className="space-y-2">
        {ideas.map((idea) => (
          <IdeaCard
            key={idea.id}
            idea={idea}
            expanded={expandedId === idea.id}
            onToggle={() => onToggle(idea.id)}
          />
        ))}
      </div>
    </section>
  )
}

function IdeaCard({
  idea,
  expanded,
  onToggle,
}: {
  idea: Idea
  expanded: boolean
  onToggle: () => void
}) {
  const updateStatus = useUpdateIdeaStatus()
  const promoteToGoal = usePromoteIdeaToGoal()
  const promoteToPursuit = usePromoteIdeaToPursuit()
  const { data: goals } = useGoals()
  const { data: pursuits } = usePursuits()
  const [showPromote, setShowPromote] = useState(false)

  const category = idea.category as IdeaCategory | null

  const meetingDate = idea.created_at
    ? new Date(idea.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 transition-colors hover:border-gray-700">
      {/* Header row — always visible */}
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <Lightbulb size={16} className="mt-0.5 flex-shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">{idea.title}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_STYLE[idea.status]}`}>
              {STATUS_LABEL[idea.status]}
            </span>
            {category && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${CATEGORY_STYLE[category]}`}>
                {CATEGORY_LABEL[category]}
              </span>
            )}
            {idea.company_name && (
              <span className="flex items-center gap-0.5 text-[10px] text-gray-500">
                <Building2 size={9} />
                {idea.company_name}
              </span>
            )}
            {idea.originated_by && (
              <span className="flex items-center gap-0.5 text-[10px] text-gray-500">
                <User size={9} />
                {idea.originated_by}
              </span>
            )}
          </div>
        </div>
        {expanded ? (
          <ChevronDown size={14} className="mt-1 flex-shrink-0 text-gray-600" />
        ) : (
          <ChevronRight size={14} className="mt-1 flex-shrink-0 text-gray-600" />
        )}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-800 px-4 py-3">
          {idea.description && (
            <p className="mb-3 text-sm text-gray-300">{idea.description}</p>
          )}

          {idea.evidence_text && (
            <div className="mb-3 rounded border border-gray-800 bg-gray-950 px-3 py-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-600">Evidence</div>
              <p className="text-xs italic text-gray-400">"{idea.evidence_text}"</p>
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
            {meetingDate && (
              <span className="flex items-center gap-1">
                <Calendar size={11} />
                {meetingDate}
              </span>
            )}
            {idea.source_meeting_id && (
              <Link
                to={`/meetings/${idea.source_meeting_id}`}
                className="text-blue-400 hover:text-blue-300"
                onClick={(e) => e.stopPropagation()}
              >
                View meeting
              </Link>
            )}
            {idea.promoted_to_goal_id && (
              <Link
                to={`/goals/${idea.promoted_to_goal_id}`}
                className="text-purple-400 hover:text-purple-300"
                onClick={(e) => e.stopPropagation()}
              >
                Linked to goal
              </Link>
            )}
            {idea.promoted_to_pursuit_id && (
              <Link
                to={`/pursuits/${idea.promoted_to_pursuit_id}`}
                className="text-purple-400 hover:text-purple-300"
                onClick={(e) => e.stopPropagation()}
              >
                Linked to pursuit
              </Link>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {idea.status === 'surfaced' && (
              <>
                <button
                  onClick={() => updateStatus.mutate({ id: idea.id, status: 'exploring' })}
                  className="flex items-center gap-1 rounded-lg bg-blue-600/20 px-2.5 py-1.5 text-xs text-blue-300 hover:bg-blue-600/30"
                >
                  <Eye size={12} />
                  Explore
                </button>
                <button
                  onClick={() => updateStatus.mutate({ id: idea.id, status: 'dismissed' })}
                  className="flex items-center gap-1 rounded-lg bg-gray-800 px-2.5 py-1.5 text-xs text-gray-400 hover:bg-gray-700"
                >
                  <X size={12} />
                  Dismiss
                </button>
              </>
            )}
            {(idea.status === 'surfaced' || idea.status === 'exploring') && (
              <button
                onClick={() => setShowPromote(!showPromote)}
                className="flex items-center gap-1 rounded-lg bg-green-600/20 px-2.5 py-1.5 text-xs text-green-300 hover:bg-green-600/30"
              >
                <Check size={12} />
                Promote
              </button>
            )}
            {idea.status === 'exploring' && (
              <button
                onClick={() => updateStatus.mutate({ id: idea.id, status: 'archived' })}
                className="flex items-center gap-1 rounded-lg bg-gray-800 px-2.5 py-1.5 text-xs text-gray-400 hover:bg-gray-700"
              >
                <Archive size={12} />
                Shelve
              </button>
            )}
            {(idea.status === 'dismissed' || idea.status === 'archived') && (
              <button
                onClick={() => updateStatus.mutate({ id: idea.id, status: 'surfaced' })}
                className="flex items-center gap-1 rounded-lg bg-gray-800 px-2.5 py-1.5 text-xs text-gray-400 hover:bg-gray-700"
              >
                Resurface
              </button>
            )}
          </div>

          {/* Promote panel */}
          {showPromote && (
            <div className="mt-3 space-y-2 rounded-lg border border-gray-800 bg-gray-950 p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">Promote to...</div>
              {(goals ?? []).length > 0 && (
                <div>
                  <div className="mb-1 text-xs text-gray-400">Goal</div>
                  <div className="flex flex-wrap gap-1">
                    {(goals ?? []).filter((g) => g.status === 'active').map((g) => (
                      <button
                        key={g.id}
                        onClick={() => {
                          promoteToGoal.mutate({ ideaId: idea.id, goalId: g.id })
                          setShowPromote(false)
                        }}
                        className="rounded bg-purple-900/30 px-2 py-1 text-xs text-purple-300 hover:bg-purple-900/50"
                      >
                        {g.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(pursuits ?? []).length > 0 && (
                <div>
                  <div className="mb-1 text-xs text-gray-400">Pursuit</div>
                  <div className="flex flex-wrap gap-1">
                    {(pursuits ?? []).filter((p) => p.status === 'active').map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          promoteToPursuit.mutate({ ideaId: idea.id, pursuitId: p.id })
                          setShowPromote(false)
                        }}
                        className="rounded bg-indigo-900/30 px-2 py-1 text-xs text-indigo-300 hover:bg-indigo-900/50"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(goals ?? []).filter((g) => g.status === 'active').length === 0 &&
                (pursuits ?? []).filter((p) => p.status === 'active').length === 0 && (
                <p className="text-xs text-gray-500">No active goals or pursuits to promote to.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
