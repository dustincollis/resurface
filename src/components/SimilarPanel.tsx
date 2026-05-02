import { Link } from 'react-router-dom'
import { Loader2, Network } from 'lucide-react'
import { useSimilarItems, type SimilarSourceTable } from '../hooks/useSimilarItems'

interface SimilarPanelProps {
  sourceTable: SimilarSourceTable
  sourceId: string
  title?: string
}

const TABLE_LABEL: Record<SimilarSourceTable, string> = {
  ideas: 'idea',
  memories: 'memory',
  commitments: 'commitment',
  meetings: 'meeting',
}

const TABLE_LINK: Record<SimilarSourceTable, (id: string) => string> = {
  ideas: () => '/ideas',
  memories: () => '/settings',
  commitments: () => '/commitments',
  meetings: (id) => `/meetings/${id}`,
}

function similarityLabel(value: number) {
  return `${Math.round(value * 100)}% similar`
}

export default function SimilarPanel({ sourceTable, sourceId, title = 'Similar' }: SimilarPanelProps) {
  const { data, isLoading, error } = useSimilarItems(sourceTable, sourceId)

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Network size={16} className="text-blue-400" />
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin" />
          Finding nearby threads...
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400">Similar items failed.</p>
      )}

      {!isLoading && !error && data?.length === 0 && (
        <p className="text-sm text-gray-500">No embedded neighbors yet.</p>
      )}

      {!isLoading && !error && data && data.length > 0 && (
        <div className="space-y-2">
          {data.map((item) => (
            <Link
              key={`${item.result_table}-${item.result_id}`}
              to={TABLE_LINK[item.result_table](item.result_id)}
              className="block rounded border border-gray-800 bg-gray-950/50 p-3 transition-colors hover:border-gray-700 hover:bg-gray-950"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                  {TABLE_LABEL[item.result_table]}
                </span>
                <span className="text-[11px] text-blue-300">{similarityLabel(item.similarity)}</span>
              </div>
              <div className="text-sm font-medium text-white">{item.title}</div>
              {item.snippet && (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">
                  {item.snippet}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
