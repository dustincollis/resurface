import { Link } from 'react-router-dom'
import { Handshake, Users, ChevronRight, Loader2 } from 'lucide-react'
import { usePartners } from '../hooks/useCompanies'

// Content partners — the platforms whose products EPAM sells/implements
// (Adobe, Sitecore, Contentful, Contentstack, etc.). Distinct from clients
// because the lens is different: partner-relationship status, joint
// pursuits, partner contacts, partnership notes — not "who owes what."
//
// Each card links to /companies/:id, which is the canonical detail page
// (it will render partner-specific sections when kind='partner').

export default function Partners() {
  const { data: partners, isLoading, error } = usePartners()

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-white">
          <Handshake size={20} className="text-purple-400" />
          Partners
        </h1>
        <p className="mt-1 text-xs text-gray-500">
          Content platforms whose products EPAM sells and implements. Click a partner for
          contacts, recent activity, joint commitments, and partnership notes.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin" />
          Loading partners...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {(error as Error).message}
        </div>
      )}

      {partners && partners.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-800 px-3 py-6 text-center text-sm text-gray-500">
          No partners tagged yet. Open a company and set its kind to "Partner" to see it here.
        </div>
      )}

      {partners && partners.length > 0 && (
        <div className="space-y-1.5">
          {partners.map((p) => (
            <Link
              key={p.id}
              to={`/companies/${p.id}`}
              className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 transition-colors hover:border-gray-700"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-base font-semibold text-white">{p.name}</span>
                  {p.domain && <span className="text-xs text-gray-600">{p.domain}</span>}
                </div>
                {p.notes && (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">
                    {p.notes}
                  </p>
                )}
                <div className="mt-1.5 flex items-center gap-3 text-[11px] text-gray-500">
                  <span className="flex items-center gap-1">
                    <Users size={11} />
                    {p.people_count} {p.people_count === 1 ? 'contact' : 'contacts'}
                  </span>
                </div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-gray-600" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
