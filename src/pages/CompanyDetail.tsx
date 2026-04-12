import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Users, Target, Handshake, Edit2, Check, X, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useCompany, useCompanyPeople, useCompanyPursuits, useCompanyCommitments, useUpdateCompany } from '../hooks/useCompanies'
import type { CommitmentStatus, PursuitStatus } from '../lib/types'

const PURSUIT_STYLE: Record<PursuitStatus, string> = {
  active: 'bg-purple-900/30 text-purple-300',
  won: 'bg-green-900/30 text-green-300',
  lost: 'bg-red-900/30 text-red-300',
  archived: 'bg-gray-800 text-gray-500',
}

const COMMITMENT_STYLE: Record<CommitmentStatus, string> = {
  open: 'bg-yellow-900/30 text-yellow-300',
  met: 'bg-green-900/30 text-green-300',
  broken: 'bg-red-900/30 text-red-300',
  cancelled: 'bg-gray-800 text-gray-500',
  waiting: 'bg-blue-900/30 text-blue-300',
  historical: 'bg-gray-800/50 text-gray-400',
}

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: company, isLoading } = useCompany(id)
  const { data: people } = useCompanyPeople(id)
  const { data: pursuits } = useCompanyPursuits(id)
  const { data: commitments } = useCompanyCommitments(id)
  const updateCompany = useUpdateCompany()

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDomain, setEditDomain] = useState('')
  const [editNotes, setEditNotes] = useState('')

  const startEdit = () => {
    if (!company) return
    setEditName(company.name)
    setEditDomain(company.domain ?? '')
    setEditNotes(company.notes ?? '')
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!company || !editName.trim()) return
    await updateCompany.mutateAsync({
      id: company.id,
      name: editName.trim(),
      domain: editDomain.trim() || null,
      notes: editNotes.trim() || null,
    })
    setEditing(false)
  }

  if (isLoading) return <div className="text-sm text-gray-500">Loading...</div>
  if (!company) return <div className="text-sm text-gray-500">Company not found</div>

  return (
    <div className="mx-auto max-w-3xl">
      <button
        onClick={() => navigate('/companies')}
        className="mb-4 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"
      >
        <ArrowLeft size={14} /> Companies
      </button>

      {/* Header */}
      <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900 p-5">
        {editing ? (
          <div className="space-y-3">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-lg font-semibold text-white focus:border-purple-500 focus:outline-none"
            />
            <input
              value={editDomain}
              onChange={(e) => setEditDomain(e.target.value)}
              placeholder="Email domain (e.g. epam.com)"
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Notes..."
              rows={2}
              className="w-full resize-y rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
            <div className="flex gap-2">
              <button onClick={saveEdit} className="flex items-center gap-1 rounded bg-purple-600 px-3 py-1.5 text-sm text-white hover:bg-purple-500">
                <Check size={14} /> Save
              </button>
              <button onClick={() => setEditing(false)} className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200">
                <X size={14} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-semibold text-white">{company.name}</h1>
              <div className="mt-1 flex items-center gap-3 text-sm text-gray-400">
                {company.domain && <span>{company.domain}</span>}
                <span>{(people ?? []).length} people</span>
                <span>{(pursuits ?? []).length} pursuits</span>
              </div>
              {company.notes && (
                <p className="mt-2 text-sm text-gray-400">{company.notes}</p>
              )}
            </div>
            <button onClick={startEdit} className="rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300">
              <Edit2 size={14} />
            </button>
          </div>
        )}
      </div>

      {/* People */}
      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          <Users size={12} /> People ({(people ?? []).length})
        </h2>
        <div className="space-y-1">
          {(people ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/people/${p.id}`)}
              className="flex w-full items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2 text-left transition-colors hover:border-gray-700"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-900/30 text-xs font-medium text-purple-300">
                {p.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-sm text-gray-200">{p.name}</span>
                {p.role && <span className="ml-2 text-xs text-gray-500">{p.role}</span>}
              </div>
              <ChevronRight size={14} className="text-gray-600" />
            </button>
          ))}
        </div>
      </section>

      {/* Pursuits */}
      {(pursuits ?? []).length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            <Target size={12} /> Pursuits ({(pursuits ?? []).length})
          </h2>
          <div className="space-y-1">
            {(pursuits ?? []).map((p) => (
              <button
                key={p.id}
                onClick={() => navigate(`/pursuits/${p.id}`)}
                className="flex w-full items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2 text-left transition-colors hover:border-gray-700"
              >
                <span className="flex-1 truncate text-sm text-gray-200">{p.name}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${PURSUIT_STYLE[p.status as PursuitStatus]}`}>
                  {p.status}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Commitments */}
      {(commitments ?? []).length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            <Handshake size={12} /> Commitments ({(commitments ?? []).length})
          </h2>
          <div className="space-y-1">
            {(commitments ?? []).map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2"
              >
                <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${COMMITMENT_STYLE[c.status as CommitmentStatus]}`}>
                  {c.status}
                </span>
                <span className="flex-1 truncate text-sm text-gray-200">{c.title}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
