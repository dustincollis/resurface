import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Building2, Mail, Tag, Calendar, Handshake, Edit2, Check, X } from 'lucide-react'
import { useState } from 'react'
import { usePerson, usePersonMeetings, usePersonCommitments, useUpdatePerson } from '../hooks/usePeople'
import { useCompanies } from '../hooks/useCompanies'
import type { CommitmentStatus } from '../lib/types'

const STATUS_STYLE: Record<CommitmentStatus, string> = {
  open: 'bg-yellow-900/30 text-yellow-300',
  met: 'bg-green-900/30 text-green-300',
  broken: 'bg-red-900/30 text-red-300',
  cancelled: 'bg-gray-800 text-gray-500',
  waiting: 'bg-blue-900/30 text-blue-300',
}

export default function PersonDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: person, isLoading } = usePerson(id)
  const { data: meetings } = usePersonMeetings(id)
  const { data: commitments } = usePersonCommitments(id)
  const { data: companies } = useCompanies()
  const updatePerson = useUpdatePerson()

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState('')
  const [editCompanyId, setEditCompanyId] = useState('')
  const [editNotes, setEditNotes] = useState('')

  const startEdit = () => {
    if (!person) return
    setEditName(person.name)
    setEditEmail(person.email ?? '')
    setEditRole(person.role ?? '')
    setEditCompanyId(person.company_id ?? '')
    setEditNotes(person.notes ?? '')
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!person || !editName.trim()) return
    await updatePerson.mutateAsync({
      id: person.id,
      name: editName.trim(),
      email: editEmail.trim() || null,
      role: editRole.trim() || null,
      company_id: editCompanyId || null,
      notes: editNotes.trim() || null,
    })
    setEditing(false)
  }

  if (isLoading) return <div className="text-sm text-gray-500">Loading...</div>
  if (!person) return <div className="text-sm text-gray-500">Person not found</div>

  return (
    <div className="mx-auto max-w-3xl">
      <button
        onClick={() => navigate('/people')}
        className="mb-4 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"
      >
        <ArrowLeft size={14} /> People
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
            <div className="grid grid-cols-2 gap-3">
              <input
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="Email"
                className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              />
              <input
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                placeholder="Role / title"
                className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              />
            </div>
            <select
              value={editCompanyId}
              onChange={(e) => setEditCompanyId(e.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 focus:border-purple-500 focus:outline-none"
            >
              <option value="">No company</option>
              {(companies ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
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
          <div>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-900/30 text-lg font-semibold text-purple-300">
                  {person.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-white">{person.name}</h1>
                  <div className="flex items-center gap-3 text-sm text-gray-400">
                    {person.role && (
                      <span className="flex items-center gap-1">
                        <Tag size={12} /> {person.role}
                      </span>
                    )}
                    {person.email && (
                      <span className="flex items-center gap-1">
                        <Mail size={12} /> {person.email}
                      </span>
                    )}
                    {person.companies && (
                      <button
                        onClick={() => navigate(`/companies/${person.company_id}`)}
                        className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
                      >
                        <Building2 size={12} /> {person.companies.name}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <button onClick={startEdit} className="rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300">
                <Edit2 size={14} />
              </button>
            </div>
            {person.notes && (
              <p className="mt-3 text-sm text-gray-400">{person.notes}</p>
            )}
            {person.aliases.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {person.aliases.map((a, i) => (
                  <span key={i} className="rounded bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400">
                    {a}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Meetings */}
      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          <Calendar size={12} /> Meetings ({(meetings ?? []).length})
        </h2>
        {(meetings ?? []).length === 0 ? (
          <div className="text-xs text-gray-600">No meetings recorded.</div>
        ) : (
          <div className="space-y-1">
            {(meetings ?? []).slice(0, 20).map((m: Record<string, unknown>) => (
              <button
                key={m.id as string}
                onClick={() => navigate(`/meetings/${m.id}`)}
                className="flex w-full items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2 text-left transition-colors hover:border-gray-700"
              >
                <span className="flex-1 truncate text-sm text-gray-200">{m.title as string}</span>
                {typeof m.start_time === 'string' && (
                  <span className="text-xs text-gray-500">
                    {new Date(m.start_time).toLocaleDateString()}
                  </span>
                )}
              </button>
            ))}
            {(meetings ?? []).length > 20 && (
              <div className="text-xs text-gray-600">+{(meetings ?? []).length - 20} more</div>
            )}
          </div>
        )}
      </section>

      {/* Commitments */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          <Handshake size={12} /> Commitments ({(commitments ?? []).length})
        </h2>
        {(commitments ?? []).length === 0 ? (
          <div className="text-xs text-gray-600">No commitments linked.</div>
        ) : (
          <div className="space-y-1">
            {(commitments ?? []).map((c: Record<string, unknown>) => (
              <div
                key={c.id as string}
                className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2"
              >
                <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${STATUS_STYLE[(c.status as CommitmentStatus) ?? 'open']}`}>
                  {c.status as string}
                </span>
                <span className="flex-1 truncate text-sm text-gray-200">{c.title as string}</span>
                <span className="text-[10px] text-gray-500">
                  {(c.direction as string) === 'incoming' ? 'they owe you' : 'you owe them'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
