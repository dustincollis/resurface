import { useMemo, useState } from 'react'
import { Loader2, Search, Sparkles, AlertCircle } from 'lucide-react'
import SimilarPanel from '../../components/SimilarPanel'
import {
  useSimilarSources,
  type SimilarSourceTable,
} from '../../hooks/useSimilarItems'
import {
  useEmbeddingStatus,
  useRunEmbeddingBackfill,
} from '../../hooks/useEmbeddingBackfill'

const TABLE_LABEL: Record<SimilarSourceTable, string> = {
  ideas: 'idea',
  memories: 'memory',
  commitments: 'commitment',
  meetings: 'meeting',
}

function formatDate(value: string | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function Similar() {
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const trimmed = query.trim()
  const { data: sources, isLoading, error } = useSimilarSources(query)
  const selected = useMemo(() => {
    if (!sources || sources.length === 0) return null
    return sources.find((source) => `${source.source_table}-${source.source_id}` === selectedKey) ?? sources[0]
  }, [selectedKey, sources])

  const helperText = useMemo(() => {
    if (trimmed.length < 2) return 'Search ideas, memories, commitments, and meetings.'
    if (isLoading) return 'Searching corpus...'
    if (error) return 'Search failed.'
    if (sources?.length === 0) return 'No matches.'
    return null
  }, [error, isLoading, sources?.length, trimmed.length])

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-white">Similar</h1>
      </div>

      <EmbeddingStatusBar />

      <div className="mb-5 rounded-lg border border-gray-800 bg-gray-900 p-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the corpus"
            className="w-full rounded-lg border border-gray-700 bg-gray-950 py-2 pl-9 pr-3 text-sm text-white placeholder:text-gray-600 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {helperText && (
          <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
            {isLoading && <Loader2 size={14} className="animate-spin" />}
            {helperText}
          </div>
        )}

        {sources && sources.length > 0 && (
          <div className="mt-4 divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800">
            {sources.map((source) => {
              const key = `${source.source_table}-${source.source_id}`
              const active = key === selectedKey
              const date = formatDate(source.created_at)

              return (
                <button
                  key={key}
                  onClick={() => setSelectedKey(key)}
                  className={`block w-full px-3 py-3 text-left transition-colors ${
                    active ? 'bg-blue-950/30' : 'bg-gray-950/40 hover:bg-gray-950'
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                      {TABLE_LABEL[source.source_table]}
                    </span>
                    {date && <span className="text-[11px] text-gray-600">{date}</span>}
                  </div>
                  <div className="text-sm font-medium text-white">{source.title}</div>
                  {source.snippet && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">
                      {source.snippet}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {selected && (
        <SimilarPanel
          sourceTable={selected.source_table}
          sourceId={selected.source_id}
          title={`Similar to ${TABLE_LABEL[selected.source_table]}`}
        />
      )}
    </div>
  )
}

// Surfaces how much of the corpus has embeddings and lets the user trigger
// a backfill from the browser. The Edge Function processes 200 rows per
// call; the hook loops until the function reports zero remaining. While a
// backfill is running, the bar shows running totals and the missing-counts
// query revalidates between batches.
function EmbeddingStatusBar() {
  const { data: status, isLoading } = useEmbeddingStatus()
  const backfill = useRunEmbeddingBackfill()

  if (isLoading || !status) return null
  const missing = status.total_missing
  const total = status.total_rows

  if (missing === 0 && !backfill.isPending && backfill.progress.embedded === 0) {
    return (
      <div className="mb-5 rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-4 py-2.5 text-xs text-emerald-300">
        Corpus fully embedded — {total.toLocaleString()} rows ready for similarity search.
      </div>
    )
  }

  return (
    <div className="mb-5 rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium">
            {missing.toLocaleString()} of {total.toLocaleString()} rows still need embeddings.
          </div>
          <div className="mt-0.5 text-xs text-amber-300/70">
            ideas {status.ideas.missing}/{status.ideas.total}
            {' · '}memories {status.memories.missing}/{status.memories.total}
            {' · '}commitments {status.commitments.missing}/{status.commitments.total}
            {' · '}meetings {status.meetings.missing}/{status.meetings.total}
          </div>
        </div>
        <button
          onClick={() => backfill.mutate()}
          disabled={backfill.isPending || missing === 0}
          className="flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-amber-50 hover:bg-amber-500 disabled:opacity-50"
        >
          {backfill.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Embedding...
            </>
          ) : (
            <>
              <Sparkles size={14} />
              Run backfill
            </>
          )}
        </button>
      </div>

      {(backfill.isPending || backfill.progress.runs > 0) && (
        <div className="mt-2 text-xs text-amber-300/80">
          {backfill.progress.embedded.toLocaleString()} embedded across {backfill.progress.runs} {backfill.progress.runs === 1 ? 'batch' : 'batches'}
          {backfill.progress.done && missing === 0 ? ' — done.' : '...'}
        </div>
      )}

      {backfill.error && (
        <div className="mt-2 flex items-start gap-2 text-xs text-red-300">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <span>{(backfill.error as Error).message}</span>
        </div>
      )}
    </div>
  )
}
