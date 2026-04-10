import { useState } from 'react'
import {
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Loader2,
  FileText,
  Flag,
} from 'lucide-react'
import {
  useTemplates,
  useTemplateSteps,
  useCreateTemplate,
  useDeleteTemplate,
  useAddTemplateStep,
  useDeleteTemplateStep,
  useUpdateTemplateStep,
} from '../hooks/useTemplates'
import type { Template, TemplateType } from '../lib/types'

export default function TemplateEditor() {
  const { data: templates } = useTemplates()
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<TemplateType>('pursuit')
  const createTemplate = useCreateTemplate()

  const handleCreate = async () => {
    if (!newName.trim()) return
    await createTemplate.mutateAsync({
      name: newName.trim(),
      template_type: newType,
    })
    setNewName('')
    setShowCreate(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Templates</h3>
          <p className="text-xs text-gray-500">
            Reusable process maps. Apply to pursuits or goals to generate a batch of steps.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((s) => !s)}
          className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-purple-500"
        >
          <Plus size={12} />
          New template
        </button>
      </div>

      {showCreate && (
        <div className="space-y-2 rounded-lg border border-gray-700 bg-gray-800 p-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Template name..."
            autoFocus
            className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-900 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setNewType('pursuit')}
                className={`flex items-center gap-1 rounded px-2 py-1 transition-colors ${
                  newType === 'pursuit'
                    ? 'bg-purple-700/40 text-purple-200'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <FileText size={10} />
                Pursuit
              </button>
              <button
                type="button"
                onClick={() => setNewType('goal')}
                className={`flex items-center gap-1 rounded px-2 py-1 transition-colors ${
                  newType === 'goal'
                    ? 'bg-purple-700/40 text-purple-200'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Flag size={10} />
                Goal
              </button>
            </div>
            <div className="ml-auto flex gap-1">
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || createTemplate.isPending}
                className="rounded bg-purple-600 px-2 py-1 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
              >
                {createTemplate.isPending ? <Loader2 size={11} className="animate-spin" /> : 'Create'}
              </button>
              <button
                onClick={() => { setShowCreate(false); setNewName('') }}
                className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {(templates ?? []).length === 0 && !showCreate ? (
        <div className="rounded-lg border border-dashed border-gray-800 px-4 py-8 text-center text-xs text-gray-500">
          No templates yet. Create one to define a repeatable process.
        </div>
      ) : (
        <div className="space-y-2">
          {(templates ?? []).map((t) => (
            <TemplateRow key={t.id} template={t} />
          ))}
        </div>
      )}
    </div>
  )
}

function TemplateRow({ template }: { template: Template }) {
  const [expanded, setExpanded] = useState(false)
  const { data: steps } = useTemplateSteps(template.id)
  const deleteTemplate = useDeleteTemplate()
  const addStep = useAddTemplateStep()
  const deleteStep = useDeleteTemplateStep()
  const updateStep = useUpdateTemplateStep()
  const [newStepTitle, setNewStepTitle] = useState('')
  const [showAddStep, setShowAddStep] = useState(false)

  const handleAddStep = async () => {
    if (!newStepTitle.trim()) return
    const maxOrder = (steps ?? []).reduce((m, s) => Math.max(m, s.sort_order), -1)
    await addStep.mutateAsync({
      template_id: template.id,
      title: newStepTitle.trim(),
      sort_order: maxOrder + 1,
    })
    setNewStepTitle('')
  }

  const handleMoveStep = async (stepId: string, direction: 'up' | 'down') => {
    if (!steps) return
    const idx = steps.findIndex((s) => s.id === stepId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= steps.length) return
    await Promise.all([
      updateStep.mutateAsync({ id: steps[idx].id, sort_order: steps[swapIdx].sort_order }),
      updateStep.mutateAsync({ id: steps[swapIdx].id, sort_order: steps[idx].sort_order }),
    ])
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/40">
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-2.5 hover:bg-gray-900/50"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
        {template.template_type === 'pursuit' ? (
          <FileText size={12} className="text-purple-400" />
        ) : (
          <Flag size={12} className="text-purple-400" />
        )}
        <span className="flex-1 text-sm font-medium text-gray-200">{template.name}</span>
        <span className="text-[10px] text-gray-500">
          {(steps ?? []).length} steps · {template.template_type}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (confirm(`Delete template "${template.name}"?`)) {
              deleteTemplate.mutate(template.id)
            }
          }}
          className="text-gray-700 hover:text-red-400"
          title="Delete template"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-gray-800 px-3 py-3">
          {(steps ?? []).length === 0 && !showAddStep && (
            <div className="mb-2 text-xs text-gray-500">No steps yet.</div>
          )}
          <div className="space-y-1">
            {(steps ?? []).map((step, idx) => (
              <div
                key={step.id}
                className="group flex items-center gap-2 rounded border border-gray-800 bg-gray-900/30 px-2 py-1.5"
              >
                <div className="flex flex-col">
                  <button
                    onClick={() => handleMoveStep(step.id, 'up')}
                    disabled={idx === 0}
                    className="text-gray-700 hover:text-gray-400 disabled:invisible"
                  >
                    <GripVertical size={8} className="rotate-180" />
                  </button>
                  <button
                    onClick={() => handleMoveStep(step.id, 'down')}
                    disabled={idx === (steps ?? []).length - 1}
                    className="text-gray-700 hover:text-gray-400 disabled:invisible"
                  >
                    <GripVertical size={8} />
                  </button>
                </div>
                <span className="flex-shrink-0 text-[10px] font-medium text-gray-600">{idx + 1}.</span>
                <span className="flex-1 text-xs text-gray-300">{step.title}</span>
                <button
                  onClick={() => deleteStep.mutate(step.id)}
                  className="text-gray-700 opacity-0 hover:text-red-400 group-hover:opacity-100"
                  title="Remove step"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2">
            {showAddStep ? (
              <div className="flex items-center gap-2">
                <input
                  value={newStepTitle}
                  onChange={(e) => setNewStepTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddStep()
                    if (e.key === 'Escape') { setShowAddStep(false); setNewStepTitle('') }
                  }}
                  placeholder="Step title..."
                  autoFocus
                  className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                />
                <button
                  onClick={handleAddStep}
                  disabled={!newStepTitle.trim() || addStep.isPending}
                  className="rounded bg-purple-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                >
                  {addStep.isPending ? <Loader2 size={10} className="animate-spin" /> : 'Add'}
                </button>
                <button
                  onClick={() => { setShowAddStep(false); setNewStepTitle('') }}
                  className="text-[11px] text-gray-400 hover:text-gray-200"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddStep(true)}
                className="flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300"
              >
                <Plus size={10} />
                Add step
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
