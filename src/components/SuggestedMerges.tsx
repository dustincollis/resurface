import { useMemo, useState } from 'react'
import { GitMerge, X, Check, Loader2 } from 'lucide-react'
import { usePeople, useMergePeople } from '../hooks/usePeople'
import type { Person } from '../lib/types'

function firstName(name: string): string {
  return name.split(/\s+/)[0].toLowerCase()
}

function isEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)
}

interface MergeSuggestion {
  keep: Person
  merge: Person
  reason: string
}

export default function SuggestedMerges() {
  const { data: people } = usePeople()
  const mergePeople = useMergePeople()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const suggestions = useMemo(() => {
    if (!people || people.length < 2) return []

    const result: MergeSuggestion[] = []
    const emailPeople = people.filter((p) => p.email && isEmail(p.email))
    const noEmailPeople = people.filter((p) => !p.email || !isEmail(p.email ?? ''))

    // For each no-email person, find email persons with matching first name
    // at the same company (or both unaffiliated)
    for (const np of noEmailPeople) {
      const npFirst = firstName(np.name)
      if (npFirst.length < 2) continue // Skip single-letter names

      for (const ep of emailPeople) {
        // Must share the same company (or both be unaffiliated)
        if (np.company_id !== ep.company_id) continue

        const epFirst = firstName(ep.name)
        if (npFirst !== epFirst) continue

        // Don't suggest if the no-email person has a full last name that
        // doesn't match the email person's last name
        const npParts = np.name.trim().split(/\s+/)
        const epParts = ep.name.trim().split(/\s+/)
        if (npParts.length > 1 && epParts.length > 1) {
          const npLast = npParts[npParts.length - 1].toLowerCase()
          const epLast = epParts[epParts.length - 1].toLowerCase()
          if (npLast !== epLast) continue // Different last names — different people
        }

        const key = `${np.id}:${ep.id}`
        if (dismissed.has(key)) continue

        const company = ep.companies
          ? ` at ${(ep.companies as { name: string }).name}`
          : ''

        result.push({
          keep: ep,
          merge: np,
          reason: `Same first name "${npFirst}"${company}`,
        })
      }
    }

    // Also check for name-subset duplicates among all people
    // e.g., "Kiley" and "Kiley Grovers" — one name is a prefix of the other
    const allSorted = [...(people ?? [])].sort((a, b) => b.name.length - a.name.length)
    for (let i = 0; i < allSorted.length; i++) {
      for (let j = i + 1; j < allSorted.length; j++) {
        const longer = allSorted[i]
        const shorter = allSorted[j]
        if (longer.id === shorter.id) continue

        const longerLower = longer.name.toLowerCase()
        const shorterLower = shorter.name.toLowerCase()

        // Exact match or shorter is a first-name-only version of longer
        const isExact = longerLower === shorterLower
        const isPrefix = !isExact &&
          shorterLower === firstName(longerLower) &&
          shorter.name.trim().split(/\s+/).length === 1

        if (!isExact && !isPrefix) continue
        // Must be same company (or both unaffiliated)
        if (longer.company_id !== shorter.company_id) continue

        const key = `${shorter.id}:${longer.id}`
        if (dismissed.has(key)) continue

        result.push({
          keep: longer,
          merge: shorter,
          reason: isExact ? 'Exact name match' : `"${shorter.name}" is likely "${longer.name}"`,
        })
      }
    }

    return result.slice(0, 10)
  }, [people, dismissed])

  if (suggestions.length === 0) return null

  return (
    <div className="mb-4 rounded-xl border border-yellow-900/30 bg-yellow-950/10 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-yellow-300">
        <GitMerge size={12} />
        Suggested merges ({suggestions.length})
      </div>
      <div className="space-y-2">
        {suggestions.map((s) => (
          <MergeRow
            key={`${s.merge.id}:${s.keep.id}`}
            suggestion={s}
            onMerge={() => mergePeople.mutate({ keepId: s.keep.id, mergeId: s.merge.id })}
            onDismiss={() => setDismissed((prev) => new Set(prev).add(`${s.merge.id}:${s.keep.id}`))}
            isPending={mergePeople.isPending}
          />
        ))}
      </div>
    </div>
  )
}

function MergeRow({
  suggestion,
  onMerge,
  onDismiss,
  isPending,
}: {
  suggestion: MergeSuggestion
  onMerge: () => void
  onDismiss: () => void
  isPending: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
      <div className="min-w-0 flex-1 text-xs">
        <div className="flex items-center gap-1.5 text-gray-300">
          <span className="font-medium">{suggestion.merge.name}</span>
          <span className="text-gray-600">→</span>
          <span className="font-medium">{suggestion.keep.name}</span>
          {suggestion.keep.email && (
            <span className="text-gray-500">({suggestion.keep.email})</span>
          )}
        </div>
        <div className="text-[10px] text-gray-500">{suggestion.reason}</div>
      </div>
      <button
        onClick={onMerge}
        disabled={isPending}
        className="flex items-center gap-1 rounded bg-green-600/20 px-2 py-1 text-[11px] text-green-300 hover:bg-green-600/30 disabled:opacity-50"
        title="Merge these records"
      >
        {isPending ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
        Merge
      </button>
      <button
        onClick={onDismiss}
        className="rounded p-1 text-gray-600 hover:text-gray-400"
        title="Not the same person"
      >
        <X size={12} />
      </button>
    </div>
  )
}
