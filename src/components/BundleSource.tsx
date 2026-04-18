import { useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle2, Circle, Clock, Loader2, RotateCcw } from 'lucide-react'
import { useBundleDocuments, useBundleGaps, useUpdateBundleGap, useIngestBundle } from '../hooks/useBundles'
import type { BundleGap } from '../lib/types'

export default function BundleSource({ bundleId }: { bundleId: string }) {
  const { data: documents } = useBundleDocuments(bundleId)
  const { data: gaps } = useBundleGaps(bundleId)
  const updateGap = useUpdateBundleGap()
  const ingest = useIngestBundle()
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null)
  const [reingestConfirm, setReingestConfirm] = useState(false)

  const handleGapToggle = (gap: BundleGap) => {
    const nextState: BundleGap['state'] =
      gap.state === 'open' ? 'resolved' : 'open'
    updateGap.mutate({ gapId: gap.id, state: nextState, bundleId })
  }

  const handleReingest = () => {
    if (!reingestConfirm) {
      setReingestConfirm(true)
      return
    }
    if (!documents) return
    ingest.mutate({
      bundleId,
      documents: documents.map((d) => ({ title: d.title, content_md: d.content_md })),
    })
    setReingestConfirm(false)
  }

  const openGaps = gaps?.filter((g) => g.state === 'open') ?? []
  const resolvedGaps = gaps?.filter((g) => g.state !== 'open') ?? []

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      {/* Gaps checklist */}
      {gaps && gaps.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Open Gaps ({openGaps.length}/{gaps.length})
          </h2>
          <div className="space-y-1.5">
            {gaps.map((gap) => (
              <button
                key={gap.id}
                onClick={() => handleGapToggle(gap)}
                disabled={updateGap.isPending}
                className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  gap.state === 'resolved'
                    ? 'border-gray-800/50 bg-gray-900/30 opacity-50'
                    : gap.state === 'deferred'
                    ? 'border-yellow-900/30 bg-yellow-950/20'
                    : 'border-gray-800 bg-gray-900/60 hover:bg-gray-800'
                }`}
              >
                <span className="mt-0.5 flex-shrink-0 text-gray-500">
                  {gap.state === 'resolved' ? (
                    <CheckCircle2 size={14} className="text-green-500" />
                  ) : gap.state === 'deferred' ? (
                    <Clock size={14} className="text-yellow-500" />
                  ) : (
                    <Circle size={14} />
                  )}
                </span>
                <span className={`text-sm ${gap.state === 'resolved' ? 'line-through text-gray-500' : 'text-gray-200'}`}>
                  {gap.content}
                </span>
              </button>
            ))}
          </div>
          {resolvedGaps.length > 0 && (
            <p className="mt-2 text-xs text-gray-600">{resolvedGaps.length} resolved — tap to uncheck</p>
          )}
        </section>
      )}

      {/* Source documents */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Source Documents ({documents?.length ?? 0})
        </h2>
        <div className="space-y-2">
          {documents?.map((doc) => (
            <div key={doc.id} className="rounded-xl border border-gray-800 bg-gray-900/40">
              <button
                onClick={() => setExpandedDoc(expandedDoc === doc.id ? null : doc.id)}
                className="flex w-full items-center justify-between px-4 py-3"
              >
                <span className="text-sm font-medium text-gray-200">{doc.title}</span>
                {expandedDoc === doc.id ? (
                  <ChevronDown size={14} className="text-gray-500" />
                ) : (
                  <ChevronRight size={14} className="text-gray-500" />
                )}
              </button>
              {expandedDoc === doc.id && (
                <div className="border-t border-gray-800 px-4 py-3">
                  <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap text-xs text-gray-400 font-mono leading-relaxed">
                    {doc.content_md}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Reset + re-ingest */}
      <section className="border-t border-gray-800 pt-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Re-ingest</h2>
        <p className="mb-3 text-xs text-gray-500">
          Re-runs chunking, embedding, entity detection, and gap extraction on the current source documents.
          Use after pasting updated content.
        </p>
        {reingestConfirm ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-yellow-400">This will clear and replace all chunks and entities. Continue?</span>
            <button
              onClick={handleReingest}
              disabled={ingest.isPending}
              className="rounded-lg bg-yellow-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-yellow-500 disabled:opacity-50"
            >
              {ingest.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Yes, re-ingest'}
            </button>
            <button
              onClick={() => setReingestConfirm(false)}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={handleReingest}
            disabled={ingest.isPending || !documents?.length}
            className="flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-xs text-gray-400 hover:border-gray-600 hover:text-gray-200 disabled:opacity-40"
          >
            <RotateCcw size={12} />
            Reset &amp; Re-ingest
          </button>
        )}
        {ingest.isSuccess && (
          <p className="mt-2 text-xs text-green-400">
            Re-ingested: {(ingest.data as { chunks?: number })?.chunks ?? '?'} chunks
          </p>
        )}
      </section>
    </div>
  )
}
