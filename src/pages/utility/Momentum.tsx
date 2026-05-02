import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  Building2,
  Loader2,
  Minus,
  TrendingDown,
  TrendingUp,
  UserRound,
} from 'lucide-react'
import Sparkline from '../../components/Sparkline'
import { useEntityMomentum, type EntityMomentum } from '../../hooks/useEntityMomentum'

type Filter = 'all' | 'person' | 'company'

function trendFor(values: number[]) {
  const recent = values.slice(-4).reduce((sum, v) => sum + v, 0)
  const prior = values.slice(-8, -4).reduce((sum, v) => sum + v, 0)
  if (recent > prior) return 'up'
  if (recent < prior) return 'down'
  return 'flat'
}

function trendLabel(values: number[]) {
  const trend = trendFor(values)
  if (trend === 'up') return { label: 'warming', icon: TrendingUp, className: 'text-emerald-300' }
  if (trend === 'down') return { label: 'cooling', icon: TrendingDown, className: 'text-amber-300' }
  return { label: 'steady', icon: Minus, className: 'text-gray-500' }
}

function MomentumRow({ entity }: { entity: EntityMomentum }) {
  const href = entity.entity_type === 'person'
    ? `/people/${entity.entity_id}`
    : `/companies/${entity.entity_id}`
  const EntityIcon = entity.entity_type === 'person' ? UserRound : Building2
  const trend = trendLabel(entity.weekly_counts)
  const TrendIcon = trend.icon

  return (
    <Link
      to={href}
      className="grid grid-cols-[1fr_auto] gap-3 rounded-lg border border-gray-800 bg-gray-900 p-3 transition-colors hover:border-gray-700 hover:bg-gray-900/80 sm:grid-cols-[1fr_130px_76px_86px]"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <EntityIcon size={14} className="shrink-0 text-gray-600" />
          <div className="truncate text-sm font-medium text-gray-100">
            {entity.entity_name}
          </div>
        </div>
        <div className="mt-1 text-[11px] uppercase tracking-wider text-gray-600">
          {entity.entity_type}
        </div>
      </div>

      <div className="hidden items-center text-purple-300 sm:flex">
        <Sparkline values={entity.weekly_counts} />
      </div>

      <div className="flex items-start justify-end sm:items-center">
        <div className="rounded border border-gray-800 px-2 py-1 text-xs text-gray-400">
          {entity.total_mentions}
        </div>
      </div>

      <div className={`col-span-2 flex items-center gap-1 text-xs sm:col-span-1 ${trend.className}`}>
        <TrendIcon size={13} />
        {trend.label}
      </div>

      <div className="col-span-2 text-purple-300 sm:hidden">
        <Sparkline values={entity.weekly_counts} width={220} height={28} />
      </div>
    </Link>
  )
}

export default function Momentum() {
  const { data: momentum, isLoading, error } = useEntityMomentum()
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(() => {
    const rows = momentum ?? []
    if (filter === 'all') return rows
    return rows.filter((entity) => entity.entity_type === filter)
  }, [momentum, filter])

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Momentum</h1>
          <p className="mt-1 text-sm text-gray-500">
            Weekly mention trends for the people and companies showing up most.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-800 bg-gray-900 p-1">
          {[
            ['all', 'All'],
            ['person', 'People'],
            ['company', 'Companies'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value as Filter)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                filter === value
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading momentum...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <AlertCircle size={16} />
            Momentum failed
          </div>
          <p className="text-red-200/80">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      )}

      {!isLoading && !error && momentum?.length === 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-500">
          No momentum snapshot yet.
        </div>
      )}

      {!isLoading && !error && momentum && momentum.length > 0 && (
        <div className="space-y-2">
          <div className="hidden grid-cols-[1fr_130px_76px_86px] gap-3 px-3 text-[11px] uppercase tracking-wider text-gray-600 sm:grid">
            <div>Entity</div>
            <div>12 weeks</div>
            <div className="text-right">Total</div>
            <div>Trend</div>
          </div>
          {filtered.length > 0 ? (
            filtered.map((entity) => (
              <MomentumRow key={`${entity.entity_type}:${entity.entity_id}`} entity={entity} />
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-gray-800 p-4 text-sm text-gray-600">
              No rows for this filter.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
