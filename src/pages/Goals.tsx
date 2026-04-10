import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Flag, Plus, ChevronRight, Loader2 } from 'lucide-react'
import { useGoals, useCreateGoal } from '../hooks/useGoals'
import { useTemplates } from '../hooks/useTemplates'
import { useApplyTemplateToGoal } from '../hooks/useGoals'
import type { Goal, GoalStatus } from '../lib/types'

const STATUS_STYLE: Record<GoalStatus, string> = {
  active: 'bg-purple-900/30 text-purple-300',
  completed: 'bg-green-900/30 text-green-300',
  archived: 'bg-gray-800 text-gray-500',
}

export default function Goals() {
  const { data: goals, isLoading } = useGoals()
  const { data: goalTemplates } = useTemplates('goal')
  const createGoal = useCreateGoal()
  const applyTemplate = useApplyTemplateToGoal()
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [error, setError] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const groups: Record<GoalStatus, Goal[]> = {
      active: [], completed: [], archived: [],
    }
    for (const g of goals ?? []) groups[g.status].push(g)
    return groups
  }, [goals])

  const handleCreate = async () => {
    if (!newName.trim()) {
      setError('Name is required.')
      return
    }
    setError(null)
    try {
      const goal = await createGoal.mutateAsync({
        name: newName.trim(),
        description: newDescription.trim() || null,
      })
      if (selectedTemplate) {
        await applyTemplate.mutateAsync({
          goalId: goal.id,
          templateId: selectedTemplate,
        })
      }
      setNewName('')
      setNewDescription('')
      setSelectedTemplate('')
      setShowForm(false)
      navigate(`/goals/${goal.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const busy = createGoal.isPending || applyTemplate.isPending

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Goals</h1>
          <p className="mt-1 text-sm text-gray-400">
            Strategic objectives — things that span quarters, not deals.
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500"
        >
          <Plus size={14} />
          New goal
        </button>
      </div>

      {showForm && (
        <div className="mb-6 space-y-3 rounded-xl border border-gray-700 bg-gray-900 p-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Goal name (e.g. Adobe Operations: QBR)"
            autoFocus
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />
          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full resize-y rounded border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />
          {(goalTemplates ?? []).length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-gray-500">From template</span>
              <select
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-300 focus:border-purple-500 focus:outline-none"
              >
                <option value="">None — start empty</option>
                {(goalTemplates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
          {error && (
            <div className="rounded border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || busy}
              className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Create
            </button>
            <button
              onClick={() => { setShowForm(false); setError(null) }}
              className="rounded-lg px-3 py-2 text-sm text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : !goals || goals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 px-6 py-16 text-center">
          <Flag size={32} className="mx-auto text-gray-700" />
          <h2 className="mt-3 text-sm font-medium text-gray-400">No goals yet</h2>
          <p className="mt-1 text-xs text-gray-600">
            Create one for things like QBR operations, GTM development, or any strategic initiative.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.active.length > 0 && (
            <GoalSection title="Active" goals={grouped.active} />
          )}
          {grouped.completed.length > 0 && (
            <GoalSection title="Completed" goals={grouped.completed} dim />
          )}
          {grouped.archived.length > 0 && (
            <GoalSection title="Archived" goals={grouped.archived} dim />
          )}
        </div>
      )}
    </div>
  )
}

function GoalSection({ title, goals, dim = false }: { title: string; goals: Goal[]; dim?: boolean }) {
  const navigate = useNavigate()
  return (
    <section className={dim ? 'opacity-60' : ''}>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
        {title} ({goals.length})
      </h2>
      <div className="space-y-2">
        {goals.map((g) => (
          <button
            key={g.id}
            onClick={() => navigate(`/goals/${g.id}`)}
            className="flex w-full items-center gap-3 rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-left transition-colors hover:border-gray-700"
          >
            <Flag size={16} className="flex-shrink-0 text-purple-400" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-white">{g.name}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_STYLE[g.status]}`}>
                  {g.status}
                </span>
              </div>
              {g.description && (
                <div className="mt-0.5 truncate text-xs text-gray-400">{g.description}</div>
              )}
            </div>
            <ChevronRight size={14} className="flex-shrink-0 text-gray-600" />
          </button>
        ))}
      </div>
    </section>
  )
}
