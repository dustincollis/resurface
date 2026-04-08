import { useNavigate } from 'react-router-dom'
import { X, Sparkles, ArrowRight, Loader2, RefreshCw } from 'lucide-react'
import type { EasyButtonResult } from '../hooks/useEasyButton'

interface EasyButtonModalProps {
  isOpen: boolean
  onClose: () => void
  result: EasyButtonResult | null
  isLoading: boolean
  onRetry: () => void
}

export default function EasyButtonModal({
  isOpen,
  onClose,
  result,
  isLoading,
  onRetry,
}: EasyButtonModalProps) {
  const navigate = useNavigate()

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-purple-900/50 bg-gray-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-purple-400" />
            <span className="text-sm font-semibold uppercase tracking-wider text-purple-300">
              Easy Win
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-5">
          {isLoading ? (
            <div className="flex flex-col items-center gap-3 py-8 text-gray-400">
              <Loader2 size={28} className="animate-spin text-purple-400" />
              <p className="text-sm">Finding you a quick win...</p>
            </div>
          ) : result ? (
            <>
              {/* Task title */}
              <h3 className="text-xl font-bold text-white">{result.task.title}</h3>

              {/* Stream + due */}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {result.task.stream_name && (
                  <span className="rounded bg-gray-800 px-2 py-0.5 font-medium uppercase tracking-wide text-gray-400">
                    {result.task.stream_name}
                  </span>
                )}
                {result.task.due_date && (
                  <span className="text-gray-500">
                    Due {new Date(result.task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>

              {/* Next step */}
              {result.task.next_action && (
                <p className="mt-3 text-sm text-gray-400">
                  <span className="text-gray-500">Next step:</span> {result.task.next_action}
                </p>
              )}

              {/* AI guidance */}
              <div className="mt-5 rounded-lg border border-purple-900/40 bg-purple-950/30 p-4">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-purple-400">
                  <Sparkles size={11} />
                  How to knock it out
                </div>
                <p className="text-sm leading-relaxed text-gray-200">
                  {result.guidance}
                </p>
              </div>

              {/* Actions */}
              <div className="mt-5 flex items-center justify-between gap-2">
                <button
                  onClick={onRetry}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 hover:bg-gray-800"
                  title="Pick a different task"
                >
                  <RefreshCw size={12} />
                  Pick another
                </button>
                <button
                  onClick={() => {
                    navigate(`/items/${result.task.id}`)
                    onClose()
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500"
                >
                  Open task <ArrowRight size={14} />
                </button>
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-gray-500">
              No active tasks to choose from. Add some tasks first.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
