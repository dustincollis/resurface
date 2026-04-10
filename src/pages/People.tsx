import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Search, Building2, ChevronRight } from 'lucide-react'
import { usePeople } from '../hooks/usePeople'
import { useCompanies } from '../hooks/useCompanies'
import type { Person } from '../lib/types'

export default function People() {
  const { data: people, isLoading } = usePeople()
  const { data: companies } = useCompanies()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState<string>('')

  const filtered = useMemo(() => {
    let list = people ?? []
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.email ?? '').toLowerCase().includes(q) ||
          (p.role ?? '').toLowerCase().includes(q) ||
          p.aliases.some((a) => a.toLowerCase().includes(q))
      )
    }
    if (companyFilter) {
      list = list.filter((p) => p.company_id === companyFilter)
    }
    return list
  }, [people, search, companyFilter])

  // Group by company for display
  const grouped = useMemo(() => {
    const byCompany = new Map<string | null, Person[]>()
    for (const p of filtered) {
      const key = p.company_id
      if (!byCompany.has(key)) byCompany.set(key, [])
      byCompany.get(key)!.push(p)
    }
    // Sort: companies with names first, then unaffiliated
    const entries = [...byCompany.entries()].sort((a, b) => {
      if (a[0] === null) return 1
      if (b[0] === null) return -1
      const aName = (companies ?? []).find((c) => c.id === a[0])?.name ?? ''
      const bName = (companies ?? []).find((c) => c.id === b[0])?.name ?? ''
      return aName.localeCompare(bName)
    })
    return entries
  }, [filtered, companies])

  const companyName = (id: string | null) => {
    if (!id) return 'Unaffiliated'
    return (companies ?? []).find((c) => c.id === id)?.name ?? 'Unknown'
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">People</h1>
        <p className="mt-1 text-sm text-gray-400">
          {(people ?? []).length} people across {(companies ?? []).length} companies
        </p>
      </div>

      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people..."
            className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2 pl-9 pr-3 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />
        </div>
        <select
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 focus:border-purple-500 focus:outline-none"
        >
          <option value="">All companies</option>
          {(companies ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          <option value="__none">Unaffiliated</option>
        </select>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 px-6 py-16 text-center">
          <Users size={32} className="mx-auto text-gray-700" />
          <h2 className="mt-3 text-sm font-medium text-gray-400">
            {search || companyFilter ? 'No matches' : 'No people yet'}
          </h2>
          <p className="mt-1 text-xs text-gray-600">
            People are created automatically from meeting attendees and commitment counterparts.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([companyId, persons]) => (
            <section key={companyId ?? 'none'}>
              <button
                onClick={() => companyId ? navigate(`/companies/${companyId}`) : undefined}
                className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-300"
              >
                <Building2 size={11} />
                {companyName(companyId)}
                <span className="text-gray-600">({persons.length})</span>
              </button>
              <div className="space-y-1">
                {persons.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => navigate(`/people/${p.id}`)}
                    className="flex w-full items-center gap-3 rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-left transition-colors hover:border-gray-700"
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-purple-900/30 text-sm font-medium text-purple-300">
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-white">{p.name}</span>
                        {p.role && (
                          <span className="truncate text-xs text-gray-500">{p.role}</span>
                        )}
                      </div>
                      {p.email && (
                        <div className="truncate text-xs text-gray-500">{p.email}</div>
                      )}
                    </div>
                    <ChevronRight size={14} className="flex-shrink-0 text-gray-600" />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
