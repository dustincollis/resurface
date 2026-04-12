import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Lightbulb, X, Loader2, RefreshCw, FileText, Target, BarChart3, MapPin, TrendingUp, Layers,
} from 'lucide-react'
import { useIdeas, useUpdateIdeaStatus, useRunClustering } from '../hooks/useIdeas'
import {
  useClusterReports,
  useGenerateClusterReport,
  REPORT_TYPE_LABELS,
  REPORT_TYPE_DESCRIPTIONS,
  type ClusterReportType,
} from '../hooks/useClusterReports'
import type { Idea, IdeaCategory } from '../lib/types'

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

const REPORT_ICONS: Record<ClusterReportType, typeof FileText> = {
  strategic_assessment: FileText,
  action_plan: Target,
  competitive_landscape: BarChart3,
  account_map: MapPin,
  trend_analysis: TrendingUp,
}

interface ClusterInfo {
  id: string
  label: string
  ideas: Idea[]
  companies: string[]
  originators: string[]
  dateRange: string
  mostRecent: string
}

export default function Ideas() {
  const { data: ideas, isLoading } = useIdeas()
  const runClustering = useRunClustering()
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null)
  const [showUnclustered, setShowUnclustered] = useState(false)
  const [clusteringStartedAt, setClusteringStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [lastResult, setLastResult] = useState<{
    clusters_found: number
    ideas_clustered: number
    ideas_unclustered: number
    at: number
  } | null>(null)

  // Tick elapsed time during clustering
  useEffect(() => {
    if (!clusteringStartedAt) return
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - clusteringStartedAt) / 1000))
    }, 250)
    return () => clearInterval(interval)
  }, [clusteringStartedAt])

  // Auto-dismiss result banner after 10s
  useEffect(() => {
    if (!lastResult) return
    const timeout = setTimeout(() => setLastResult(null), 10000)
    return () => clearTimeout(timeout)
  }, [lastResult])

  const handleRunClustering = () => {
    setClusteringStartedAt(Date.now())
    setElapsed(0)
    setLastResult(null)
    runClustering.mutate(undefined, {
      onSuccess: (data) => {
        setClusteringStartedAt(null)
        setLastResult({
          clusters_found: data.clusters_found,
          ideas_clustered: data.ideas_clustered,
          ideas_unclustered: data.ideas_unclustered,
          at: Date.now(),
        })
      },
      onError: () => {
        setClusteringStartedAt(null)
      },
    })
  }

  // Build cluster list
  const { clusters, unclustered, totalIdeas } = useMemo(() => {
    if (!ideas) return { clusters: [] as ClusterInfo[], unclustered: [] as Idea[], totalIdeas: 0 }

    const clusterMap = new Map<string, Idea[]>()
    const unc: Idea[] = []

    for (const idea of ideas) {
      if (idea.cluster_id && idea.cluster_label) {
        const existing = clusterMap.get(idea.cluster_id) || []
        existing.push(idea)
        clusterMap.set(idea.cluster_id, existing)
      } else {
        unc.push(idea)
      }
    }

    const clusterList: ClusterInfo[] = []
    for (const [id, clusterIdeas] of clusterMap) {
      const label = clusterIdeas[0].cluster_label!
      const companies = [...new Set(clusterIdeas.map((i) => i.company_name).filter(Boolean) as string[])]
      const originators = [...new Set(clusterIdeas.map((i) => i.originated_by).filter(Boolean) as string[])]
      const dates = clusterIdeas.map((i) => i.created_at).sort()
      const earliest = new Date(dates[0]).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      const latest = new Date(dates[dates.length - 1]).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      const dateRange = earliest === latest ? earliest : `${earliest} – ${latest}`

      clusterList.push({
        id,
        label,
        ideas: clusterIdeas,
        companies,
        originators,
        dateRange,
        mostRecent: dates[dates.length - 1],
      })
    }

    // Sort by idea count desc
    clusterList.sort((a, b) => b.ideas.length - a.ideas.length)

    return { clusters: clusterList, unclustered: unc, totalIdeas: ideas.length }
  }, [ideas])

  // Auto-select first cluster
  const selectedCluster = useMemo(() => {
    if (showUnclustered) return null
    if (selectedClusterId) return clusters.find((c) => c.id === selectedClusterId) || null
    return clusters[0] || null
  }, [clusters, selectedClusterId, showUnclustered])

  const accountCount = useMemo(() => {
    const all = new Set<string>()
    for (const c of clusters) for (const co of c.companies) all.add(co)
    return all.size
  }, [clusters])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading...</div>
    )
  }

  if (!ideas || ideas.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-xl border border-dashed border-gray-800 px-6 py-16 text-center">
          <Lightbulb size={32} className="mx-auto text-gray-700" />
          <h2 className="mt-3 text-sm font-medium text-gray-400">No ideas yet</h2>
          <p className="mt-1 text-xs text-gray-600">
            Ideas are extracted from meeting transcripts during AI parsing.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex -m-6 h-[calc(100%+48px)]">
      {/* Left panel: Cluster navigator */}
      <div className="flex w-72 flex-shrink-0 flex-col border-r border-gray-800">
        <div className="border-b border-gray-800 px-4 py-3">
          <h1 className="text-lg font-semibold text-white">Ideas</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            {totalIdeas} ideas from {accountCount} accounts — {clusters.length} themes identified
          </p>
        </div>

        {/* Clustering in progress — persistent overlay */}
        {clusteringStartedAt && (
          <div className="border-b border-gray-800 bg-blue-900/10 px-3 py-3">
            <div className="flex items-start gap-2">
              <Loader2 size={13} className="mt-0.5 flex-shrink-0 animate-spin text-blue-400" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-blue-200">
                  Clustering {totalIdeas} ideas...
                </p>
                <p className="mt-0.5 text-[10px] text-blue-300/70">
                  {elapsed}s elapsed · usually takes 20-40s
                </p>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-blue-950">
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: `${Math.min(95, (elapsed / 30) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Result banner — persists for 10s after completion */}
        {!clusteringStartedAt && lastResult && (
          <div className="border-b border-gray-800 bg-green-900/10 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <Layers size={13} className="mt-0.5 flex-shrink-0 text-green-400" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-green-200">
                  Clustering complete
                </p>
                <p className="mt-0.5 text-[10px] text-green-300/70">
                  {lastResult.clusters_found} themes · {lastResult.ideas_clustered} grouped · {lastResult.ideas_unclustered} unclustered
                </p>
              </div>
              <button
                onClick={() => setLastResult(null)}
                className="rounded p-0.5 text-green-400/60 hover:bg-green-900/30 hover:text-green-300"
              >
                <X size={11} />
              </button>
            </div>
          </div>
        )}

        {/* Re-cluster suggestion when unclustered count is high */}
        {!clusteringStartedAt && !lastResult && unclustered.length > 20 && (
          <div className="border-b border-gray-800 bg-amber-900/10 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <Layers size={13} className="mt-0.5 flex-shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] leading-tight text-amber-200">
                  {unclustered.length} ideas haven't been clustered yet.
                </p>
                <button
                  onClick={handleRunClustering}
                  disabled={runClustering.isPending}
                  className="mt-1.5 flex items-center gap-1 rounded bg-amber-900/30 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-900/50 disabled:opacity-50"
                >
                  <Layers size={10} />
                  Run clustering
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-0.5 p-2">
            {clusters.map((cluster) => {
              const isActive = selectedCluster?.id === cluster.id && !showUnclustered
              return (
                <button
                  key={cluster.id}
                  onClick={() => { setSelectedClusterId(cluster.id); setShowUnclustered(false) }}
                  className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                    isActive
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium leading-tight">{cluster.label}</span>
                      <span className="flex-shrink-0 rounded-full bg-gray-700/50 px-1.5 py-0.5 text-[10px] text-gray-400">
                        {cluster.ideas.length}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-gray-600">
                      {cluster.companies.length > 0 ? cluster.companies.slice(0, 3).join(', ') : 'General'}
                      {cluster.companies.length > 3 && ` +${cluster.companies.length - 3}`}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Unclustered */}
          {unclustered.length > 0 && (
            <div className="border-t border-gray-800 p-2">
              <button
                onClick={() => { setShowUnclustered(true); setSelectedClusterId(null) }}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  showUnclustered
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-500 hover:bg-gray-800/50 hover:text-gray-300'
                }`}
              >
                <span className="flex-1">Unclustered</span>
                <span className="rounded-full bg-gray-700/50 px-1.5 py-0.5 text-[10px] text-gray-500">
                  {unclustered.length}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right panel: Detail view */}
      <div className="flex-1 overflow-y-auto">
        {showUnclustered ? (
          <UnclusteredView ideas={unclustered} />
        ) : selectedCluster ? (
          <ClusterDetailView cluster={selectedCluster} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-600">
            Select a cluster to explore
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Cluster Detail View
// ============================================================

function ClusterDetailView({ cluster }: { cluster: ClusterInfo }) {
  const [activeReport, setActiveReport] = useState<ClusterReportType | null>(null)
  const [expandedIdeaId, setExpandedIdeaId] = useState<string | null>(null)

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-white">{cluster.label}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span>{cluster.ideas.length} ideas</span>
          <span>·</span>
          <span>{cluster.originators.length} originators</span>
          <span>·</span>
          <span>{cluster.companies.length} accounts</span>
          <span>·</span>
          <span>{cluster.dateRange}</span>
        </div>
        {cluster.companies.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {cluster.companies.map((co) => (
              <span key={co} className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">
                {co}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Ideas timeline */}
      <div className="mb-6">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-600">Ideas</h3>
        <div className="space-y-0.5">
          {cluster.ideas.map((idea) => (
            <IdeaTimelineRow
              key={idea.id}
              idea={idea}
              expanded={expandedIdeaId === idea.id}
              onToggle={() => setExpandedIdeaId(expandedIdeaId === idea.id ? null : idea.id)}
            />
          ))}
        </div>
      </div>

      {/* Report actions */}
      <div className="mb-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-600">Analysis</h3>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(REPORT_TYPE_LABELS) as ClusterReportType[]).map((type) => {
            const Icon = REPORT_ICONS[type]
            const isActive = activeReport === type
            return (
              <button
                key={type}
                onClick={() => setActiveReport(isActive ? null : type)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors ${
                  isActive
                    ? 'border-gray-600 bg-gray-800 text-white'
                    : 'border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-300'
                }`}
              >
                <Icon size={13} />
                {REPORT_TYPE_LABELS[type]}
              </button>
            )
          })}
        </div>
      </div>

      {/* Report content */}
      {activeReport && (
        <ReportPanel clusterId={cluster.id} reportType={activeReport} />
      )}
    </div>
  )
}

// ============================================================
// Idea Timeline Row
// ============================================================

function IdeaTimelineRow({
  idea,
  expanded,
  onToggle,
}: {
  idea: Idea
  expanded: boolean
  onToggle: () => void
}) {
  const updateStatus = useUpdateIdeaStatus()
  const date = new Date(idea.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const category = idea.category as IdeaCategory | null

  return (
    <div className={`rounded-lg transition-colors ${expanded ? 'bg-gray-900 border border-gray-800' : 'hover:bg-gray-900/50'}`}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
      >
        <span className="w-12 flex-shrink-0 text-[11px] text-gray-600">{date}</span>
        <span className="w-20 flex-shrink-0 truncate text-[11px] text-gray-500">
          {idea.originated_by || '—'}
        </span>
        {idea.company_name && (
          <span className="flex-shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">
            {idea.company_name}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{idea.title}</span>
        {idea.status === 'exploring' && (
          <span className="flex-shrink-0 rounded bg-blue-900/30 px-1 py-0.5 text-[9px] text-blue-300">exploring</span>
        )}
        {idea.status === 'accepted' && (
          <span className="flex-shrink-0 rounded bg-green-900/30 px-1 py-0.5 text-[9px] text-green-300">accepted</span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-gray-800 px-3 py-3">
          {idea.description && (
            <p className="mb-2 text-sm text-gray-300">{idea.description}</p>
          )}
          {idea.evidence_text && (
            <p className="mb-2 text-xs italic text-gray-500">"{idea.evidence_text}"</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {category && (
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">
                {CATEGORY_LABEL[category]}
              </span>
            )}
            {idea.source_meeting_id && (
              <Link
                to={`/meetings/${idea.source_meeting_id}`}
                className="text-[11px] text-blue-400 hover:text-blue-300"
              >
                Source meeting
              </Link>
            )}
            <div className="ml-auto flex gap-1">
              {idea.status === 'surfaced' && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: idea.id, status: 'exploring' }) }}
                    className="rounded bg-blue-900/30 px-2 py-1 text-[10px] text-blue-300 hover:bg-blue-900/50"
                  >
                    Explore
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: idea.id, status: 'dismissed' }) }}
                    className="rounded bg-gray-800 px-2 py-1 text-[10px] text-gray-500 hover:bg-gray-700"
                  >
                    Dismiss
                  </button>
                </>
              )}
              {idea.status === 'exploring' && (
                <button
                  onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: idea.id, status: 'archived' }) }}
                  className="rounded bg-gray-800 px-2 py-1 text-[10px] text-gray-500 hover:bg-gray-700"
                >
                  Shelve
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Report Panel
// ============================================================

function ReportPanel({
  clusterId,
  reportType,
}: {
  clusterId: string
  reportType: ClusterReportType
}) {
  const { data: cachedReports } = useClusterReports(clusterId)
  const generateReport = useGenerateClusterReport()

  const cached = cachedReports?.find((r) => r.report_type === reportType)
  const isGenerating = generateReport.isPending

  const handleGenerate = (regenerate = false) => {
    generateReport.mutate({ cluster_id: clusterId, report_type: reportType, regenerate })
  }

  // Auto-generate if no cache
  if (!cached && !isGenerating && !generateReport.data && !generateReport.error) {
    // Show generate button instead of auto-firing
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-center">
        <p className="mb-3 text-sm text-gray-400">
          {REPORT_TYPE_DESCRIPTIONS[reportType]}
        </p>
        <button
          onClick={() => handleGenerate()}
          className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
        >
          Generate {REPORT_TYPE_LABELS[reportType]}
        </button>
      </div>
    )
  }

  if (isGenerating) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={14} className="animate-spin" />
          Generating {REPORT_TYPE_LABELS[reportType]}...
        </div>
      </div>
    )
  }

  const content = generateReport.data?.content || cached?.content
  const generatedAt = generateReport.data?.generated_at || cached?.generated_at

  if (generateReport.error) {
    return (
      <div className="rounded-xl border border-red-900/30 bg-red-950/20 p-4">
        <p className="text-sm text-red-300">Failed to generate report. Try again.</p>
        <button
          onClick={() => handleGenerate(true)}
          className="mt-2 rounded bg-gray-800 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!content) return null

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-2">
        <span className="text-xs font-medium text-gray-400">{REPORT_TYPE_LABELS[reportType]}</span>
        <div className="flex items-center gap-2">
          {generatedAt && (
            <span className="text-[10px] text-gray-600">
              {new Date(generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
          <button
            onClick={() => handleGenerate(true)}
            disabled={isGenerating}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-800 hover:text-gray-300"
          >
            <RefreshCw size={10} />
            Regenerate
          </button>
        </div>
      </div>
      <div className="prose-invert p-5">
        <ReportContent content={content} />
      </div>
    </div>
  )
}

// ============================================================
// Report Markdown Renderer
// ============================================================

function ReportContent({ content }: { content: string }) {
  // Simple markdown-ish rendering: headers, bold, paragraphs
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let key = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      elements.push(<div key={key++} className="h-3" />)
      continue
    }
    if (trimmed.startsWith('## ')) {
      elements.push(
        <h3 key={key++} className="mb-2 mt-4 text-sm font-semibold text-white first:mt-0">
          {trimmed.replace('## ', '')}
        </h3>
      )
    } else if (trimmed.startsWith('# ')) {
      elements.push(
        <h2 key={key++} className="mb-3 mt-4 text-base font-semibold text-white first:mt-0">
          {trimmed.replace('# ', '')}
        </h2>
      )
    } else if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      elements.push(
        <p key={key++} className="mb-1 mt-3 text-sm font-semibold text-gray-200">
          {trimmed.replace(/\*\*/g, '')}
        </p>
      )
    } else {
      // Render inline bold
      const parts = trimmed.split(/(\*\*[^*]+\*\*)/g)
      elements.push(
        <p key={key++} className="mb-2 text-sm leading-relaxed text-gray-300">
          {parts.map((part, i) =>
            part.startsWith('**') && part.endsWith('**') ? (
              <strong key={i} className="font-semibold text-white">
                {part.replace(/\*\*/g, '')}
              </strong>
            ) : (
              part
            )
          )}
        </p>
      )
    }
  }

  return <>{elements}</>
}

// ============================================================
// Unclustered View
// ============================================================

function UnclusteredView({ ideas }: { ideas: Idea[] }) {
  const updateStatus = useUpdateIdeaStatus()

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-white">Unclustered Ideas</h2>
        <p className="mt-1 text-sm text-gray-500">
          {ideas.length} ideas that haven't been grouped into themes yet. Re-run clustering after more meetings are parsed to pick these up.
        </p>
      </div>

      <div className="space-y-1">
        {ideas.map((idea) => {
          const date = new Date(idea.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          return (
            <div key={idea.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-gray-900/50">
              <span className="w-12 flex-shrink-0 text-[11px] text-gray-600">{date}</span>
              {idea.company_name && (
                <span className="flex-shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">
                  {idea.company_name}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-gray-300">{idea.title}</span>
              {idea.status === 'surfaced' && (
                <button
                  onClick={() => updateStatus.mutate({ id: idea.id, status: 'dismissed' })}
                  className="flex-shrink-0 rounded bg-gray-800 p-1 text-gray-600 hover:bg-gray-700 hover:text-gray-400"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
