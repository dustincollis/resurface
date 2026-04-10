import { useState } from 'react'
import { Check, Circle, FileText, Loader2 } from 'lucide-react'
import { usePlaybookSteps, useMarkPlaybookStep } from '../hooks/usePursuits'
import type { PlaybookStep } from '../lib/types'

export default function PlaybookHealth({ pursuitId }: { pursuitId: string }) {
  const { data: steps, isLoading } = usePlaybookSteps(pursuitId)
  const markStep = useMarkPlaybookStep()

  if (isLoading) return null
  if (!steps || steps.length === 0) return null

  const evidenced = steps.filter((s) => s.evidenced).length
  const total = steps.length
  const progress = total > 0 ? Math.round((evidenced / total) * 100) : 0

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900">
      <div className="border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-purple-400" />
            <span className="text-sm font-medium text-gray-300">Playbook</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full rounded-full bg-purple-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-gray-500">{evidenced}/{total}</span>
          </div>
        </div>
      </div>

      <div className="divide-y divide-gray-800/50">
        {steps.map((step, idx) => (
          <StepRow key={step.id} step={step} index={idx} markStep={markStep} />
        ))}
      </div>
    </div>
  )
}

function StepRow({
  step,
  index,
  markStep,
}: {
  step: PlaybookStep
  index: number
  markStep: ReturnType<typeof useMarkPlaybookStep>
}) {
  const [showNote, setShowNote] = useState(false)
  const [note, setNote] = useState('')

  const handleToggle = () => {
    if (step.evidenced) {
      // Un-evidence
      markStep.mutate({ stepId: step.id, evidenced: false })
    } else {
      setShowNote(true)
    }
  }

  const handleSubmitEvidence = () => {
    markStep.mutate({
      stepId: step.id,
      evidenced: true,
      evidence_type: 'manual',
      evidence_note: note.trim() || null,
    })
    setShowNote(false)
    setNote('')
  }

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <span className="w-5 text-right text-[10px] font-medium text-gray-600">
          {index + 1}
        </span>
        <button
          onClick={handleToggle}
          disabled={markStep.isPending}
          className={`flex-shrink-0 transition-colors ${
            step.evidenced ? 'text-green-400' : 'text-gray-600 hover:text-gray-400'
          }`}
        >
          {markStep.isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : step.evidenced ? (
            <Check size={16} />
          ) : (
            <Circle size={16} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <span className={`text-sm ${step.evidenced ? 'text-gray-500' : 'text-gray-200'}`}>
            {step.title}
          </span>
          {step.evidenced && step.evidence_note && (
            <div className="mt-0.5 text-xs text-gray-500 italic">
              {step.evidence_note}
            </div>
          )}
          {step.evidenced && step.evidenced_at && (
            <div className="mt-0.5 text-[10px] text-gray-600">
              Evidenced {new Date(step.evidenced_at).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>

      {showNote && (
        <div className="mt-2 ml-8 flex items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmitEvidence()
              if (e.key === 'Escape') { setShowNote(false); setNote('') }
            }}
            placeholder="How was this done? (optional)"
            autoFocus
            className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />
          <button
            onClick={handleSubmitEvidence}
            className="rounded bg-green-600/30 px-2 py-1 text-[11px] text-green-300 hover:bg-green-600/40"
          >
            Done
          </button>
          <button
            onClick={() => { setShowNote(false); setNote('') }}
            className="text-[11px] text-gray-500 hover:text-gray-300"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
