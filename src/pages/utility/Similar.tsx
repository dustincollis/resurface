import { useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import SimilarPanel from '../../components/SimilarPanel'
import {
  useSimilarSources,
  type SimilarSourceTable,
} from '../../hooks/useSimilarItems'

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
