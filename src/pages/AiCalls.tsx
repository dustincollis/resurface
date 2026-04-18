import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Zap, TrendingDown, Gauge, DollarSign } from 'lucide-react'
import { useAiTelemetry, estimateCost, estimateUncachedCost } from '../hooks/useAiTelemetry'
import type { AiCallTelemetry } from '../lib/types'

export default function AiCalls() {
  const { data: rows, isLoading } = useAiTelemetry({ limit: 200 })

  const summary = useMemo(() => {
    if (!rows || rows.length === 0) return null
    let totalCost = 0
    let uncachedCost = 0
    let totalInput = 0
    let totalCacheRead = 0
    let totalCacheWrite = 0
    let totalOutput = 0
    for (const r of rows) {
      totalCost += estimateCost(r)
      uncachedCost += estimateUncachedCost(r)
      totalInput += r.input_tokens
      totalCacheRead += r.cache_read_input_tokens
      totalCacheWrite += r.cache_creation_input_tokens
      totalOutput += r.output_tokens
    }
    const cachedInputAll = totalCacheRead + totalCacheWrite
    const hitRate =
      cachedInputAll > 0 ? totalCacheRead / (totalCacheRead + totalCacheWrite) : 0
    const savings = uncachedCost - totalCost
    return {
      calls: rows.length,
      totalCost,
      uncachedCost,
      savings,
      savingsPct: uncachedCost > 0 ? savings / uncachedCost : 0,
      hitRate,
      totalInput,
      totalCacheRead,
      totalCacheWrite,
      totalOutput,
    }
  }, [rows])

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">AI calls</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every Claude API call logged with usage, latency, and estimated cost. Last 200 calls.
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : !rows || rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 px-6 py-16 text-center">
          <Zap size={28} className="mx-auto text-gray-700" />
          <h2 className="mt-3 text-sm font-medium text-gray-400">No telemetry yet</h2>
          <p className="mt-1 text-xs text-gray-600">
            Rows show up here after any AI edge function runs. Next parse will populate it.
          </p>
        </div>
      ) : (
        <>
          {summary && (
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                icon={<Zap size={14} className="text-purple-400" />}
                label="Calls"
                value={summary.calls.toString()}
              />
              <Stat
                icon={<DollarSign size={14} className="text-green-400" />}
                label="Cost"
                value={formatUsd(summary.totalCost)}
                sub={summary.savings > 0.001 ? `saved ${formatUsd(summary.savings)} (${Math.round(summary.savingsPct * 100)}%)` : undefined}
                subIcon={summary.savings > 0.001 ? <TrendingDown size={10} /> : undefined}
              />
              <Stat
                icon={<Gauge size={14} className="text-blue-400" />}
                label="Cache hit rate"
                value={`${Math.round(summary.hitRate * 100)}%`}
                sub={`${formatTokens(summary.totalCacheRead)} read / ${formatTokens(summary.totalCacheWrite)} written`}
              />
              <Stat
                icon={<Zap size={14} className="text-yellow-400" />}
                label="Tokens out"
                value={formatTokens(summary.totalOutput)}
                sub={`${formatTokens(summary.totalInput)} uncached in`}
              />
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
            <table className="w-full text-xs">
              <thead className="border-b border-gray-800 bg-gray-950/50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Function</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 text-right font-medium">Input</th>
                  <th className="px-3 py-2 text-right font-medium">Cached r/w</th>
                  <th className="px-3 py-2 text-right font-medium">Output</th>
                  <th className="px-3 py-2 text-right font-medium">Latency</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row key={r.id} row={r} />
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-gray-600">
            Cost is an estimate using current list prices (cached reads at 0.1×, cache writes at 1.25×). Your actual bill is authoritative.
          </p>
        </>
      )}
    </div>
  )
}

function Row({ row }: { row: AiCallTelemetry }) {
  const cost = estimateCost(row)
  const uncached = estimateUncachedCost(row)
  const saved = uncached - cost
  const cached = row.cache_read_input_tokens + row.cache_creation_input_tokens

  const sourceLink =
    row.source_type === 'meeting' && row.source_id
      ? `/meetings/${row.source_id}`
      : null

  const when = formatRelative(row.created_at)

  return (
    <tr className="border-b border-gray-800/60 last:border-b-0 hover:bg-gray-900/60">
      <td className="px-3 py-2 text-gray-400" title={new Date(row.created_at).toLocaleString()}>
        {when}
      </td>
      <td className="px-3 py-2">
        {sourceLink ? (
          <Link to={sourceLink} className="text-gray-200 hover:text-white">
            {row.function_name}
          </Link>
        ) : (
          <span className="text-gray-200">{row.function_name}</span>
        )}
      </td>
      <td className="px-3 py-2 text-gray-500">{shortModel(row.model)}</td>
      <td className="px-3 py-2 text-right font-mono text-gray-300">{formatTokens(row.input_tokens)}</td>
      <td className="px-3 py-2 text-right font-mono text-gray-300">
        {cached === 0 ? (
          <span className="text-gray-700">—</span>
        ) : (
          <>
            <span className="text-blue-300" title="cache read">{formatTokens(row.cache_read_input_tokens)}</span>
            <span className="text-gray-700"> / </span>
            <span className="text-purple-300" title="cache write">{formatTokens(row.cache_creation_input_tokens)}</span>
          </>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono text-gray-300">{formatTokens(row.output_tokens)}</td>
      <td className="px-3 py-2 text-right font-mono text-gray-500">
        {row.latency_ms ? `${(row.latency_ms / 1000).toFixed(1)}s` : '—'}
      </td>
      <td className="px-3 py-2 text-right font-mono text-gray-200" title={saved > 0.001 ? `saved ${formatUsd(saved)} vs uncached` : undefined}>
        {formatUsd(cost)}
      </td>
    </tr>
  )
}

function Stat({
  icon,
  label,
  value,
  sub,
  subIcon,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  subIcon?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
      {sub && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-green-400">
          {subIcon}
          {sub}
        </div>
      )}
    </div>
  )
}

function shortModel(m: string): string {
  return m.replace('claude-', '')
}

function formatTokens(n: number): string {
  if (n === 0) return '0'
  if (n < 1000) return n.toString()
  if (n < 10_000) return `${(n / 1000).toFixed(1)}K`
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
