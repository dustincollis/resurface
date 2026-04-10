import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Flag, Trash2, Plus, Check, RotateCcw, Archive,
  Circle, CheckCircle, Clock, SkipForward, Loader2,
  Target, Handshake, Calendar, Zap, Hash,
  RefreshCw, Link2,
} from 'lucide-react'
import {
  useGoal,
  useGoalTasks,
  useUpdateGoal,
  useSetGoalStatus,
  useDeleteGoal,
  useCreateGoalTask,
  useSetGoalTaskStatus,
  useDeleteGoalTask,
  useEvaluateGoal,
} from '../hooks/useGoals'
import { usePursuits } from '../hooks/usePursuits'
import InlineEditable from '../components/InlineEditable'
import GoalChat from '../components/GoalChat'
import type { GoalTask, GoalTaskStatus, MilestoneConditionType } from '../lib/types'

const CONDITION_ICON: Record<MilestoneConditionType, typeof Circle> = {
  manual: Circle,
  pursuit: Target,
  item: Zap,
  commitment: Handshake,
  meeting: Calendar,
  count: Hash,
}

const CONDITION_LABEL: Record<MilestoneConditionType, string> = {
  manual: 'Manual',
  pursuit: 'Pursuit',
  item: 'Task',
  commitment: 'Commitment',
  meeting: 'Meeting',
  count: 'Count',
}

export default function GoalDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: goal, isLoading } = useGoal(id!)
  const { data: tasks } = useGoalTasks(id!)
  const { data: pursuits } = usePursuits()
  const updateGoal = useUpdateGoal()
  const setStatus = useSetGoalStatus()
  const deleteGoal = useDeleteGoal()
  const createTask = useCreateGoalTask()
  const setTaskStatus = useSetGoalTaskStatus()
  const deleteTask = useDeleteGoalTask()
  const evaluateGoal = useEvaluateGoal()

  const [showAddMilestone, setShowAddMilestone] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newConditionType, setNewConditionType] = useState<MilestoneConditionType>('manual')
  const [newLinkedId, setNewLinkedId] = useState('')
  const [newTargetStatus, setNewTargetStatus] = useState('')

  // Auto-evaluate on mount
  useEffect(() => {
    if (id && tasks && tasks.some((t) => t.condition_type !== 'manual')) {
      evaluateGoal.mutate(id)
    }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const all = tasks ?? []
    const active = all.filter((t) => t.status !== 'skipped')
    const done = active.filter((t) => t.status === 'done')
    const computed = all.filter((t) => t.condition_type !== 'manual')
    const computedMet = computed.filter((t) => t.condition_met)
    const manual = all.filter((t) => t.condition_type === 'manual')
    const manualDone = manual.filter((t) => t.status === 'done')

    return {
      total: active.length,
      done: done.length,
      progress: active.length > 0 ? done.length / active.length : 0,
      computed: computed.length,
      computedMet: computedMet.length,
      manual: manual.length,
      manualDone: manualDone.length,
    }
  }, [tasks])

  if (isLoading || !goal) {
    return <div className="text-gray-400">Loading...</div>
  }

  const handleDelete = () => {
    if (confirm(`Delete goal "${goal.name}"?`)) {
      deleteGoal.mutate(goal.id, { onSuccess: () => navigate('/goals') })
    }
  }

  const handleAddMilestone = async () => {
    if (!newTitle.trim()) return
    const maxOrder = (tasks ?? []).reduce((m, t) => Math.max(m, t.sort_order), -1)
    await createTask.mutateAsync({
      goal_id: goal.id,
      title: newTitle.trim(),
      sort_order: maxOrder + 1,
      condition_type: newConditionType,
      linked_entity_id: newLinkedId || null,
      target_status: newTargetStatus || null,
    })
    setNewTitle('')
    setNewConditionType('manual')
    setNewLinkedId('')
    setNewTargetStatus('')
    setShowAddMilestone(false)
    // Re-evaluate after adding
    if (newConditionType !== 'manual') {
      evaluateGoal.mutate(goal.id)
    }
  }

  const cycleTaskStatus = (task: GoalTask) => {
    if (task.condition_type !== 'manual') return // Can't manually cycle computed milestones
    const order: GoalTaskStatus[] = ['pending', 'in_progress', 'done']
    const idx = order.indexOf(task.status)
    const next = order[(idx + 1) % order.length]
    setTaskStatus(task.id, next)
  }

  // Radial progress for the hero viz
  const circumference = 2 * Math.PI * 60
  const strokeDashoffset = circumference - stats.progress * circumference

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => navigate('/goals')}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"
        >
          <ArrowLeft size={16} /> Back to Goals
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => evaluateGoal.mutate(goal.id)}
            disabled={evaluateGoal.isPending}
            className="flex items-center gap-1 rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-purple-400"
            title="Re-evaluate milestones"
          >
            <RefreshCw size={14} className={evaluateGoal.isPending ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleDelete}
            className="flex items-center gap-1 rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-red-400"
            title="Delete goal"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Hero visualizer */}
      <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900 p-6">
        <div className="flex items-center gap-6">
          {/* Radial progress */}
          <div className="relative flex-shrink-0">
            <svg width="140" height="140" className="-rotate-90">
              {/* Background track */}
              <circle
                cx="70" cy="70" r="60"
                fill="none"
                stroke="rgb(31, 41, 55)"
                strokeWidth="8"
              />
              {/* Computed progress (purple) */}
              <circle
                cx="70" cy="70" r="60"
                fill="none"
                stroke="rgb(139, 92, 246)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                className="transition-all duration-700 ease-out"
              />
              {/* Glow effect when > 50% */}
              {stats.progress > 0.5 && (
                <circle
                  cx="70" cy="70" r="60"
                  fill="none"
                  stroke="rgb(139, 92, 246)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  opacity="0.3"
                  filter="blur(4px)"
                />
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold text-white">
                {Math.round(stats.progress * 100)}%
              </span>
              <span className="text-[10px] text-gray-500">
                {stats.done}/{stats.total}
              </span>
            </div>
          </div>

          {/* Goal info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Flag size={18} className="flex-shrink-0 text-purple-400" />
              <InlineEditable
                as="h1"
                value={goal.name}
                onSave={(v) => updateGoal.mutate({ id: goal.id, name: v })}
                className="text-xl font-semibold text-white"
                placeholder="Untitled goal"
              />
            </div>
            <InlineEditable
              as="p"
              value={goal.description ?? ''}
              onSave={(v) => updateGoal.mutate({ id: goal.id, description: v || null })}
              className="mt-1 text-sm text-gray-400"
              placeholder="Add a description..."
              multiline
            />

            {/* Stats chips */}
            <div className="mt-3 flex flex-wrap gap-2">
              {stats.computed > 0 && (
                <div className="flex items-center gap-1.5 rounded-full bg-purple-900/20 px-2.5 py-1 text-[11px]">
                  <Zap size={10} className="text-purple-400" />
                  <span className="text-purple-300">{stats.computedMet}/{stats.computed} auto-tracked</span>
                </div>
              )}
              {stats.manual > 0 && (
                <div className="flex items-center gap-1.5 rounded-full bg-gray-800 px-2.5 py-1 text-[11px]">
                  <Circle size={10} className="text-gray-500" />
                  <span className="text-gray-400">{stats.manualDone}/{stats.manual} manual</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status actions */}
        <div className="mt-4 flex gap-2 border-t border-gray-800 pt-3">
          {goal.status === 'active' ? (
            <>
              <button
                onClick={() => setStatus(goal.id, 'completed')}
                className="flex items-center gap-1.5 rounded bg-green-600/20 px-2.5 py-1 text-xs font-medium text-green-300 hover:bg-green-600/30"
              >
                <Check size={12} /> Complete
              </button>
              <button
                onClick={() => setStatus(goal.id, 'archived')}
                className="flex items-center gap-1.5 rounded bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-400 hover:bg-gray-700"
              >
                <Archive size={12} /> Archive
              </button>
            </>
          ) : (
            <button
              onClick={() => setStatus(goal.id, 'active')}
              className="flex items-center gap-1.5 rounded bg-purple-600/20 px-2.5 py-1 text-xs font-medium text-purple-300 hover:bg-purple-600/30"
            >
              <RotateCcw size={12} /> Reactivate
            </button>
          )}
        </div>
      </div>

      {/* Milestones */}
      <div className="rounded-xl border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-6 py-3">
          <h3 className="text-sm font-medium text-gray-300">
            Milestones ({(tasks ?? []).length})
          </h3>
        </div>

        <div className="divide-y divide-gray-800/50">
          {(tasks ?? []).map((task) => (
            <MilestoneRow
              key={task.id}
              task={task}
              onCycle={() => cycleTaskStatus(task)}
              onSkip={() => setTaskStatus(task.id, task.status === 'skipped' ? 'pending' : 'skipped')}
              onDelete={() => deleteTask.mutate(task.id)}
              navigate={navigate}
            />
          ))}
        </div>

        {(tasks ?? []).length === 0 && !showAddMilestone && (
          <div className="px-6 py-8 text-center text-xs text-gray-500">
            No milestones yet. Add one to start tracking progress.
          </div>
        )}

        {/* Add milestone */}
        <div className="border-t border-gray-800 px-6 py-3">
          {showAddMilestone ? (
            <div className="space-y-3">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddMilestone()
                  if (e.key === 'Escape') setShowAddMilestone(false)
                }}
                placeholder="Milestone title..."
                autoFocus
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              />

              {/* Condition type selector — visual buttons, not a dropdown */}
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-gray-500">Tracking</div>
                <div className="flex flex-wrap gap-1.5">
                  {(['manual', 'pursuit', 'item', 'commitment', 'meeting', 'count'] as MilestoneConditionType[]).map((ct) => {
                    const Icon = CONDITION_ICON[ct]
                    const active = newConditionType === ct
                    return (
                      <button
                        key={ct}
                        onClick={() => {
                          setNewConditionType(ct)
                          setNewLinkedId('')
                          setNewTargetStatus('')
                        }}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
                          active
                            ? 'bg-purple-700/30 text-purple-200 border border-purple-700/50'
                            : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600 hover:text-gray-300'
                        }`}
                      >
                        <Icon size={12} />
                        {CONDITION_LABEL[ct]}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Condition-specific config */}
              {newConditionType === 'pursuit' && (
                <div className="flex gap-2">
                  <select
                    value={newLinkedId}
                    onChange={(e) => setNewLinkedId(e.target.value)}
                    className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-300 focus:border-purple-500 focus:outline-none"
                  >
                    <option value="">Select pursuit...</option>
                    {(pursuits ?? []).map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.status})</option>
                    ))}
                  </select>
                  <select
                    value={newTargetStatus}
                    onChange={(e) => setNewTargetStatus(e.target.value)}
                    className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-300 focus:border-purple-500 focus:outline-none"
                  >
                    <option value="">When status reaches...</option>
                    <option value="won">Won</option>
                    <option value="active">Active</option>
                    <option value="lost">Lost</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              )}

              {newConditionType === 'count' && (
                <div className="text-xs text-gray-500 italic">
                  Count conditions can be configured after creation via the API. Tracks how many entities match a criteria.
                </div>
              )}

              {(newConditionType === 'item' || newConditionType === 'commitment') && (
                <div className="text-xs text-gray-500 italic">
                  Link to a specific {newConditionType} by ID after creation. Auto-completes when it reaches the target status.
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleAddMilestone}
                  disabled={!newTitle.trim() || createTask.isPending}
                  className="flex items-center gap-1 rounded bg-purple-600 px-3 py-1.5 text-sm text-white hover:bg-purple-500 disabled:opacity-50"
                >
                  {createTask.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Add milestone
                </button>
                <button
                  onClick={() => { setShowAddMilestone(false); setNewTitle('') }}
                  className="rounded px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddMilestone(true)}
              className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300"
            >
              <Plus size={12} />
              Add milestone
            </button>
          )}
        </div>

        {/* AI Goal Planner */}
        <GoalChat goalId={goal.id} />
      </div>
    </div>
  )
}

function MilestoneRow({
  task,
  onCycle,
  onSkip,
  onDelete,
  navigate,
}: {
  task: GoalTask
  onCycle: () => void
  onSkip: () => void
  onDelete: () => void
  navigate: ReturnType<typeof useNavigate>
}) {
  const isDone = task.status === 'done'
  const isSkipped = task.status === 'skipped'
  const isComputed = task.condition_type !== 'manual'
  const CondIcon = CONDITION_ICON[task.condition_type]

  // Status icon
  const StatusIcon = isDone
    ? CheckCircle
    : task.status === 'in_progress'
      ? Clock
      : isSkipped
        ? SkipForward
        : Circle

  const statusColor = isDone
    ? 'text-green-400'
    : task.status === 'in_progress'
      ? 'text-blue-400'
      : isSkipped
        ? 'text-gray-600'
        : isComputed && task.condition_met
          ? 'text-green-400'
          : 'text-gray-500'

  return (
    <div className={`${isDone || isSkipped ? 'opacity-50' : ''}`}>
      <div className="group flex items-center gap-3 px-6 py-3">
        {/* Status indicator */}
        <button
          onClick={isComputed ? undefined : onCycle}
          className={`flex-shrink-0 ${statusColor} ${isComputed ? 'cursor-default' : 'cursor-pointer hover:opacity-80'}`}
          title={isComputed ? `Auto-tracked: ${task.condition_met ? 'condition met' : 'pending'}` : `Click to cycle status`}
        >
          <StatusIcon size={18} />
        </button>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-sm ${isDone ? 'text-gray-500 line-through' : isSkipped ? 'text-gray-600 line-through' : 'text-gray-200'}`}>
              {task.title}
            </span>
            {isComputed && (
              <span className="flex items-center gap-1 rounded-full bg-purple-900/20 px-2 py-0.5 text-[10px] text-purple-300">
                <CondIcon size={9} />
                {CONDITION_LABEL[task.condition_type]}
              </span>
            )}
          </div>

          {/* Evidence / evaluation result */}
          {task.evidence_text && (
            <div className={`mt-0.5 text-xs ${task.condition_met ? 'text-green-400/70' : 'text-gray-500'}`}>
              {task.evidence_text}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
          {isComputed && task.linked_entity_id && (
            <button
              onClick={() => {
                const prefix = task.condition_type === 'pursuit' ? '/pursuits'
                  : task.condition_type === 'item' ? '/items'
                  : task.condition_type === 'commitment' ? '/commitments'
                  : null
                if (prefix) navigate(`${prefix}/${task.linked_entity_id}`)
              }}
              className="rounded p-1 text-gray-600 hover:text-purple-400"
              title="Go to linked entity"
            >
              <Link2 size={12} />
            </button>
          )}
          {task.last_evaluated_at && (
            <span className="text-[9px] text-gray-600" title={`Last checked: ${new Date(task.last_evaluated_at).toLocaleString()}`}>
              {new Date(task.last_evaluated_at).toLocaleDateString()}
            </span>
          )}
          <button
            onClick={onSkip}
            className="text-[10px] text-gray-600 hover:text-gray-300"
          >
            {isSkipped ? 'unskip' : 'skip'}
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1 text-gray-700 hover:text-red-400"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  )
}
