import { useState } from 'react'
import { ChevronDown, ChevronRight, Filter, Loader2, Play, Mail, FileText, Image as ImageIcon } from 'lucide-react'
import { useTriageSkippedInputs, useProcessSkippedAnyway } from '../hooks/useTriageSkippedInputs'
import type { ReviewInput } from '../lib/types'

// Collapsed-by-default panel showing recent inputs the catalog decided
// weren't worth synthesizing. "Process anyway" flips the decision and fires
// full synthesis for that input.
export default function TriageSkippedSection() {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useTriageSkippedInputs(25)
  const process = useProcessSkippedAnyway()

  if (isLoading) return null
  if (!data || data.length === 0) return null

  return (
    <div className="mb-4 rounded-xl border border-gray-800 bg-gray-900/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-400 hover:text-gray-200"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Filter size={12} />
        Skipped by triage ({data.length})
        <span className="ml-auto text-[10px] text-gray-600">click to expand</span>
      </button>
      {open && (
        <div className="space-y-1 border-t border-gray-800 p-2">
          {data.map((input) => (
            <SkippedRow key={input.id} input={input} onProcess={() => process.mutate(input)} processing={process.isPending} />
          ))}
        </div>
      )}
    </div>
  )
}

function SkippedRow({
  input,
  onProcess,
  processing,
}: {
  input: ReviewInput
  onProcess: () => void
  processing: boolean
}) {
  const Icon =
    input.input_type === 'email' ? Mail : input.input_type === 'screenshot' ? ImageIcon : FileText
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
      <Icon size={12} className="flex-shrink-0 text-gray-500" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-gray-200">{input.title}</div>
        {input.triage_reason && (
          <div className="truncate text-[11px] italic text-gray-500">{input.triage_reason}</div>
        )}
      </div>
      <button
        onClick={onProcess}
        disabled={processing}
        title="Process anyway — run full synthesis on this input"
        className="flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-800 disabled:opacity-50"
      >
        {processing ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
        Process anyway
      </button>
    </div>
  )
}
