import { useNavigate } from 'react-router-dom'
import { Building2, ChevronRight, Users } from 'lucide-react'
import { useCompanies } from '../hooks/useCompanies'
import { usePeople } from '../hooks/usePeople'
import { useMemo } from 'react'

export default function Companies() {
  const { data: companies, isLoading } = useCompanies()
  const { data: people } = usePeople()
  const navigate = useNavigate()

  const peopleCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of people ?? []) {
      if (p.company_id) {
        counts.set(p.company_id, (counts.get(p.company_id) ?? 0) + 1)
      }
    }
    return counts
  }, [people])

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Companies</h1>
        <p className="mt-1 text-sm text-gray-400">
          {(companies ?? []).length} companies tracked
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : (companies ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 px-6 py-16 text-center">
          <Building2 size={32} className="mx-auto text-gray-700" />
          <h2 className="mt-3 text-sm font-medium text-gray-400">No companies yet</h2>
          <p className="mt-1 text-xs text-gray-600">
            Companies are created automatically from pursuits, commitments, and meeting attendee domains.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {(companies ?? []).map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/companies/${c.id}`)}
              className="flex w-full items-center gap-3 rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-left transition-colors hover:border-gray-700"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-900/20 text-sm font-semibold text-blue-300">
                {c.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-white">{c.name}</span>
                  {c.domain && (
                    <span className="text-xs text-gray-500">{c.domain}</span>
                  )}
                </div>
                {c.aliases.length > 0 && (
                  <div className="mt-0.5 truncate text-xs text-gray-500">
                    Also: {c.aliases.join(', ')}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Users size={12} />
                {peopleCounts.get(c.id) ?? 0}
              </div>
              <ChevronRight size={14} className="flex-shrink-0 text-gray-600" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
