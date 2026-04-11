import { useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Search, Building2, ChevronRight, Star } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { usePeople } from '../hooks/usePeople'
import { useCompanies } from '../hooks/useCompanies'
import { supabase } from '../lib/supabase'
import SuggestedMerges from '../components/SuggestedMerges'
import type { Person } from '../lib/types'

export default function People() {
  const { data: people, isLoading } = usePeople()
  const { data: companies } = useCompanies()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState<string>('')
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

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
    if (companyFilter === '__none') {
      list = list.filter((p) => !p.company_id)
    } else if (companyFilter) {
      list = list.filter((p) => p.company_id === companyFilter)
    }
    return list
  }, [people, search, companyFilter])

  // Frequent contacts: people with the most meeting appearances
  const { data: meetingCounts } = useQuery({
    queryKey: ['people_meeting_counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meeting_attendees')
        .select('person_id')
      if (error) throw error
      const counts = new Map<string, number>()
      for (const row of data ?? []) {
        counts.set(row.person_id, (counts.get(row.person_id) ?? 0) + 1)
      }
      return counts
    },
  })

  const frequentContacts = useMemo(() => {
    if (search || companyFilter || !meetingCounts) return []
    const all = people ?? []
    return all
      .map((p) => ({ person: p, count: meetingCounts.get(p.id) ?? 0 }))
      .filter((s) => s.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
      .map((s) => s.person)
  }, [people, meetingCounts, search, companyFilter])

  // Group by first letter
  const alphabetGroups = useMemo(() => {
    const groups = new Map<string, Person[]>()
    for (const p of filtered) {
      const letter = p.name.charAt(0).toUpperCase()
      if (!groups.has(letter)) groups.set(letter, [])
      groups.get(letter)!.push(p)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const activeLetters = new Set(alphabetGroups.map(([letter]) => letter))

  const scrollToLetter = (letter: string) => {
    sectionRefs.current[letter]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const companyName = (id: string | null) => {
    if (!id) return null
    return (companies ?? []).find((c) => c.id === id)?.name ?? null
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

      <SuggestedMerges />

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 px-6 py-16 text-center">
          <Users size={32} className="mx-auto text-gray-700" />
          <h2 className="mt-3 text-sm font-medium text-gray-400">
            {search || companyFilter ? 'No matches' : 'No people yet'}
          </h2>
        </div>
      ) : (
        <div className="flex gap-4">
          {/* Main list */}
          <div className="min-w-0 flex-1 space-y-4">
            {/* Frequent contacts */}
            {frequentContacts.length > 0 && (
              <section>
                <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-gray-500">
                  <Star size={11} /> Frequent contacts
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {frequentContacts.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => navigate(`/people/${p.id}`)}
                      className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-1.5 text-left transition-colors hover:border-gray-700"
                    >
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-900/30 text-[10px] font-medium text-purple-300">
                        {p.name.charAt(0)}
                      </div>
                      <div className="text-xs">
                        <span className="text-gray-200">{p.name}</span>
                        {p.companies && (
                          <span className="ml-1 text-gray-500">{(p.companies as { name: string }).name}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Alphabetical sections */}
            {alphabetGroups.map(([letter, persons]) => (
              <section
                key={letter}
                ref={(el) => { sectionRefs.current[letter] = el }}
              >
                <h2 className="mb-1.5 text-lg font-bold text-gray-600">{letter}</h2>
                <div className="space-y-1">
                  {persons.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => navigate(`/people/${p.id}`)}
                      className="flex w-full items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-left transition-colors hover:border-gray-700"
                    >
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-purple-900/30 text-xs font-medium text-purple-300">
                        {p.name.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-200">{p.name}</span>
                          {p.role && (
                            <span className="truncate text-xs text-gray-600">{p.role}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          {companyName(p.company_id) && (
                            <span className="flex items-center gap-1">
                              <Building2 size={10} />
                              {companyName(p.company_id)}
                            </span>
                          )}
                          {p.email && (
                            <span className="truncate">{p.email}</span>
                          )}
                        </div>
                      </div>
                      <ChevronRight size={14} className="flex-shrink-0 text-gray-600" />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* Alphabet sidebar */}
          <div className="sticky top-0 flex flex-col items-center gap-0.5 pt-8">
            {Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ').map((letter) => (
              <button
                key={letter}
                onClick={() => scrollToLetter(letter)}
                disabled={!activeLetters.has(letter)}
                className={`w-6 rounded py-0.5 text-center text-[10px] font-medium transition-colors ${
                  activeLetters.has(letter)
                    ? 'text-purple-400 hover:bg-purple-900/30'
                    : 'text-gray-700 cursor-default'
                }`}
              >
                {letter}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
