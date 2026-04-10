import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Flag, Trash2, Plus, Check, RotateCcw, Archive,
  GripVertical, Circle, CheckCircle, Clock, SkipForward, Loader2,
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
} from '../hooks/useGoals'
import InlineEditable from '../components/InlineEditable'
import type { GoalTask, GoalTaskStatus } from '../lib/types'

const TASK_STATUS_ICON: Record<GoalTaskStatus, typeof Circle> = {
  pending: Circle,
  in_progress: Clock,
  done: CheckCircle,
  skipped: SkipForward,
}

const TASK_STATUS_STYLE: Record<GoalTaskStatus, string> = {
  pending: 'text-gray-500',
  in_progress: 'text-blue-400',
  done: 'text-green-400',
  skipped: 'text-gray-600',
}

export default function GoalDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: goal, isLoading } = useGoal(id!)
  const { data: tasks } = useGoalTasks(id!)
  const updateGoal = useUpdateGoal()
  const setStatus = useSetGoalStatus()
  const deleteGoal = useDeleteGoal()
  const createTask = useCreateGoalTask()
  const setTaskStatus = useSetGoalTaskStatus()
  const deleteTask = useDeleteGoalTask()

  const [showAddTask, setShowAddTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')

  if (isLoading || !goal) {
    return <div className="text-gray-400">Loading...</div>
  }

  const handleDelete = () => {
    if (confirm(`Delete goal "${goal.name}"? This deletes all its tasks too.`)) {
      deleteGoal.mutate(goal.id, { onSuccess: () => navigate('/goals') })
    }
  }

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return
    const maxOrder = (tasks ?? []).reduce((m, t) => Math.max(m, t.sort_order), -1)
    await createTask.mutateAsync({
      goal_id: goal.id,
      title: newTaskTitle.trim(),
      sort_order: maxOrder + 1,
    })
    setNewTaskTitle('')
  }

  const doneCount = (tasks ?? []).filter((t) => t.status === 'done').length
  const totalCount = (tasks ?? []).filter((t) => t.status !== 'skipped').length
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  const cycleTaskStatus = (task: GoalTask) => {
    const order: GoalTaskStatus[] = ['pending', 'in_progress', 'done']
    const idx = order.indexOf(task.status)
    const next = order[(idx + 1) % order.length]
    setTaskStatus(task.id, next)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => navigate('/goals')}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"
        >
          <ArrowLeft size={16} /> Back to Goals
        </button>
        <button
          onClick={handleDelete}
          className="flex items-center gap-1 rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-red-400"
          title="Delete goal"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900">
        {/* Header */}
        <div className="border-b border-gray-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <Flag size={20} className="text-purple-400" />
            <InlineEditable
              as="h1"
              value={goal.name}
              onSave={(v) => updateGoal.mutate({ id: goal.id, name: v })}
              className="text-xl font-semibold text-white"
              placeholder="Untitled goal"
            />
          </div>
          <div className="mt-2">
            <InlineEditable
              as="p"
              value={goal.description ?? ''}
              onSave={(v) => updateGoal.mutate({ id: goal.id, description: v || null })}
              className="text-sm text-gray-400"
              placeholder="Add a description..."
              multiline
            />
          </div>

          {/* Progress bar */}
          {totalCount > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800">
                <div
                  className="h-full rounded-full bg-purple-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-gray-400">
                {doneCount}/{totalCount} ({progress}%)
              </span>
            </div>
          )}
        </div>

        {/* Status actions */}
        <div className="flex flex-wrap gap-2 border-b border-gray-800 px-6 py-3">
          {goal.status === 'active' ? (
            <>
              <button
                onClick={() => setStatus(goal.id, 'completed')}
                className="flex items-center gap-1.5 rounded bg-green-600/20 px-2.5 py-1 text-xs font-medium text-green-300 hover:bg-green-600/30"
              >
                <Check size={12} />
                Complete
              </button>
              <button
                onClick={() => setStatus(goal.id, 'archived')}
                className="flex items-center gap-1.5 rounded bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-400 hover:bg-gray-700"
              >
                <Archive size={12} />
                Archive
              </button>
            </>
          ) : (
            <button
              onClick={() => setStatus(goal.id, 'active')}
              className="flex items-center gap-1.5 rounded bg-purple-600/20 px-2.5 py-1 text-xs font-medium text-purple-300 hover:bg-purple-600/30"
            >
              <RotateCcw size={12} />
              Reactivate
            </button>
          )}
        </div>

        {/* Task checklist */}
        <div className="px-6 py-4">
          <h3 className="mb-3 text-sm font-medium text-gray-300">
            Tasks ({(tasks ?? []).length})
          </h3>

          {(tasks ?? []).length === 0 && !showAddTask && (
            <div className="text-xs text-gray-500">
              No tasks yet. Add one below or create this goal from a template.
            </div>
          )}

          <div className="space-y-1">
            {(tasks ?? []).map((task) => {
              const StatusIcon = TASK_STATUS_ICON[task.status]
              const statusStyle = TASK_STATUS_STYLE[task.status]
              const isDone = task.status === 'done'
              const isSkipped = task.status === 'skipped'
              return (
                <div
                  key={task.id}
                  className={`group flex items-center gap-2 rounded-lg border border-gray-800 px-3 py-2 ${
                    isDone || isSkipped ? 'opacity-50' : ''
                  }`}
                >
                  <GripVertical size={12} className="flex-shrink-0 text-gray-700 opacity-0 group-hover:opacity-100" />
                  <button
                    onClick={() => cycleTaskStatus(task)}
                    className={`flex-shrink-0 ${statusStyle}`}
                    title={`Status: ${task.status}. Click to cycle.`}
                  >
                    <StatusIcon size={16} />
                  </button>
                  <span className={`flex-1 text-sm ${isDone ? 'text-gray-500 line-through' : isSkipped ? 'text-gray-600 line-through' : 'text-gray-200'}`}>
                    {task.title}
                  </span>
                  {task.due_date && (
                    <span className="text-[10px] text-gray-500">
                      {new Date(task.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  <button
                    onClick={() => {
                      if (isSkipped) {
                        setTaskStatus(task.id, 'pending')
                      } else {
                        setTaskStatus(task.id, 'skipped')
                      }
                    }}
                    className="text-[10px] text-gray-600 opacity-0 hover:text-gray-300 group-hover:opacity-100"
                    title={isSkipped ? 'Unskip' : 'Skip'}
                  >
                    {isSkipped ? 'unskip' : 'skip'}
                  </button>
                  <button
                    onClick={() => deleteTask.mutate(task.id)}
                    className="text-gray-700 opacity-0 hover:text-red-400 group-hover:opacity-100"
                    title="Delete"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Add task */}
          <div className="mt-3">
            {showAddTask ? (
              <div className="flex items-center gap-2">
                <input
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddTask()
                    if (e.key === 'Escape') { setShowAddTask(false); setNewTaskTitle('') }
                  }}
                  placeholder="Task title..."
                  autoFocus
                  className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                />
                <button
                  onClick={handleAddTask}
                  disabled={!newTaskTitle.trim() || createTask.isPending}
                  className="flex items-center gap-1 rounded bg-purple-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                >
                  {createTask.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  Add
                </button>
                <button
                  onClick={() => { setShowAddTask(false); setNewTaskTitle('') }}
                  className="rounded px-2 py-1.5 text-xs text-gray-400 hover:text-gray-200"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddTask(true)}
                className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300"
              >
                <Plus size={12} />
                Add task
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
