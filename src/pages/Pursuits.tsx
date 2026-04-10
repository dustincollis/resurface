import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Target, Plus, ChevronRight, Check, X, Trophy, Frown, Archive, Loader2 } from 'lucide-react'
import { usePursuits, useCreatePursuit, useAddPursuitMember } from '../hooks/usePursuits'
import { useTemplates } from '../hooks/useTemplates'
import { useCreateItem } from '../hooks/useItems'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import type { Pursuit, PursuitStatus } from '../lib/types'

const STATUS_LABEL: Record<PursuitStatus, string> = {
  active: 'Active',
  won: 'Won',
  lost: 'Lost',
  archived: 'Archived',
}

const STATUS_STYLE: Record<PursuitStatus, string> = {
  active: 'bg-purple-900/30 text-purple-300',
  won: 'bg-green-900/30 text-green-300',
  lost: 'bg-red-900/30 text-red-300',
  archived: 'bg-gray-800 text-gray-500',
}

export default function Pursuits() {
  const { data: pursuits, isLoading } = usePursuits()
  const { data: pursuitTemplates } = useTemplates('pursuit')
  const createPursuit = useCreatePursuit()
  const createItem = useCreateItem()
  const addMember = useAddPursuitMember()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCompany, setNewCompany] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [error, setError] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const groups: Record<PursuitStatus, Pursuit[]> = {
      active: [], won: [], lost: [], archived: [],
    }
    for (const p of pursuits ?? []) {
      groups[p.status].push(p)
    }
    return groups
  }, [pursuits])

  const handleCreate = async () => {
    if (!newName.trim()) {
      setError('Name is required.')
      return
    }
    setError(null)
    try {
      const pursuit = await createPursuit.mutateAsync({
        name: newName.trim(),
        company: newCompany.trim() || null,
        description: newDescription.trim() || null,
      })

      // Apply template: create items from template steps and link to pursuit
      if (selectedTemplate && user) {
        const { data: steps } = await supabase
          .from('template_steps')
          .select('*')
          .eq('template_id', selectedTemplate)
          .order('sort_order')
        for (const step of steps ?? []) {
          const item = await createItem.mutateAsync({
            title: step.title,
            description: step.description ?? undefined,
          })
          await addMember.mutateAsync({
            pursuitId: pursuit.id,
            memberType: 'item',
            memberId: item.id,
          })
        }
      }

      setNewName('')
      setNewCompany('')
      setNewDescription('')
      setSelectedTemplate('')
      setShowForm(false)
      navigate(`/pursuits/${pursuit.id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.includes('duplicate') ? 'A pursuit with that name already exists.' : msg)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Pursuits</h1>
          <p className="mt-1 text-sm text-gray-400">
            Threads of focus you've decided matter — items, commitments, and meetings grouped under one banner.
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500"
        >
          <Plus size={14} />
          New pursuit
        </button>
      </div>

      {showForm && (
        <div className="mb-6 space-y-3 rounded-xl border border-gray-700 bg-gray-900 p-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Pursuit name (e.g. S&P Mobility)"
            autoFocus
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />
          <input
            value={newCompany}
            onChange={(e) => setNewCompany(e.target.value)}
            placeholder="Company (optional)"
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />
          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            className="w-full resize-y rounded border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />
          {(pursuitTemplates ?? []).length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-gray-500">From template</span>
              <select
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-300 focus:border-purple-500 focus:outline-none"
              >
                <option value="">None — start empty</option>
                {(pursuitTemplates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
          {error && (
            <div className="rounded border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || createPursuit.isPending}
              className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {createPursuit.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Create
            </button>
            <button
              onClick={() => {
                setShowForm(false)
                setNewName('')
                setNewCompany('')
                setNewDescription('')
                setError(null)
              }}
              disabled={createPursuit.isPending}
              className="rounded-lg px-3 py-2 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : !pursuits || pursuits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 px-6 py-16 text-center">
          <Target size={32} className="mx-auto text-gray-700" />
          <h2 className="mt-3 text-sm font-medium text-gray-400">No pursuits yet</h2>
          <p className="mt-1 text-xs text-gray-600">
            Create one to flag threads of work that should stay surfaced even when other things crowd them out.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.active.length > 0 && (
            <PursuitSection title="Active" pursuits={grouped.active} />
          )}
          {grouped.won.length > 0 && (
            <PursuitSection title="Won" pursuits={grouped.won} dim />
          )}
          {grouped.lost.length > 0 && (
            <PursuitSection title="Lost" pursuits={grouped.lost} dim />
          )}
          {grouped.archived.length > 0 && (
            <PursuitSection title="Archived" pursuits={grouped.archived} dim />
          )}
        </div>
      )}
    </div>
  )
}

function PursuitSection({ title, pursuits, dim = false }: { title: string; pursuits: Pursuit[]; dim?: boolean }) {
  const navigate = useNavigate()
  return (
    <section className={dim ? 'opacity-60' : ''}>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
        {title} ({pursuits.length})
      </h2>
      <div className="space-y-2">
        {pursuits.map((p) => (
          <button
            key={p.id}
            onClick={() => navigate(`/pursuits/${p.id}`)}
            className="flex w-full items-center gap-3 rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-left transition-colors hover:border-gray-700"
          >
            <div
              className="h-3 w-3 flex-shrink-0 rounded-full"
              style={{ backgroundColor: p.color }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-white">{p.name}</span>
                {p.company && (
                  <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] text-blue-300">
                    {p.company}
                  </span>
                )}
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_STYLE[p.status]}`}
                >
                  {STATUS_LABEL[p.status]}
                </span>
              </div>
              {p.description && (
                <div className="mt-0.5 truncate text-xs text-gray-400">{p.description}</div>
              )}
            </div>
            <ChevronRight size={14} className="flex-shrink-0 text-gray-600" />
          </button>
        ))}
      </div>
    </section>
  )
}

// Re-export icons that PursuitDetail needs (avoids extra imports there)
export { Trophy, Frown, Archive, Check, X }
