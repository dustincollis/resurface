import { useEffect, useRef, type ReactNode } from 'react'
import { Loader2, RefreshCw, Printer, WifiOff } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useBundleReport, useGenerateBundleReport } from '../hooks/useBundleReport'
import { useBundle } from '../hooks/useBundles'

const OFFLINE_KEY = (bundleId: string) => `resurface_bundle_report_${bundleId}`

export default function BundleReport({ bundleId }: { bundleId: string }) {
  const { data: report, isLoading } = useBundleReport(bundleId)
  const { data: bundle } = useBundle(bundleId)
  const generate = useGenerateBundleReport()
  const qc = useQueryClient()
  const isOffline = !navigator.onLine

  const reportStatus = bundle?.report_status ?? 'idle'
  const isGenerating = reportStatus === 'generating' || generate.isPending

  // When background worker flips status from 'generating' to 'ready',
  // refetch the report content so it renders without a manual reload.
  const prevStatus = useRef(reportStatus)
  useEffect(() => {
    if (prevStatus.current === 'generating' && reportStatus === 'ready') {
      qc.invalidateQueries({ queryKey: ['bundle_report', bundleId] })
    }
    prevStatus.current = reportStatus
  }, [reportStatus, bundleId, qc])

  // Persist report to localStorage for offline access
  useEffect(() => {
    if (report?.content_md) {
      try {
        localStorage.setItem(OFFLINE_KEY(bundleId), JSON.stringify({
          content_md: report.content_md,
          generated_at: report.generated_at,
        }))
      } catch {
        // localStorage quota exceeded — ignore
      }
    }
  }, [report, bundleId])

  // Read from localStorage when offline
  const offlineFallback = isOffline && !report ? (() => {
    try {
      const stored = localStorage.getItem(OFFLINE_KEY(bundleId))
      return stored ? JSON.parse(stored) as { content_md: string; generated_at: string } : null
    } catch { return null }
  })() : null

  const displayReport = report ?? offlineFallback

  const handleGenerate = () => {
    generate.mutate(bundleId)
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3 print:hidden">
        <div className="text-xs text-gray-500">
          {displayReport ? `Generated ${new Date(displayReport.generated_at).toLocaleString()}` : 'No report yet'}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
          >
            <Printer size={12} />
            Print / Save PDF
          </button>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs text-white hover:bg-purple-500 disabled:opacity-50"
          >
            {isGenerating ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {isGenerating ? 'Generating…' : displayReport ? 'Regenerate' : 'Generate Report'}
          </button>
        </div>
      </div>

      {generate.error && (
        <div className="border-b border-red-900/40 bg-red-950/30 px-4 py-2 text-xs text-red-300 print:hidden">
          {generate.error instanceof Error ? generate.error.message : String(generate.error)}
        </div>
      )}
      {reportStatus === 'failed' && bundle?.report_error && (
        <div className="border-b border-red-900/40 bg-red-950/30 px-4 py-2 text-xs text-red-300 print:hidden">
          Last generation failed: {bundle.report_error}
        </div>
      )}

      {/* Report content */}
      <div className="flex-1 overflow-y-auto px-4 py-6 print:overflow-visible print:px-0 print:py-0">
        {isOffline && offlineFallback && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-yellow-900/40 bg-yellow-950/20 px-3 py-2 text-xs text-yellow-400 print:hidden">
            <WifiOff size={12} />
            Reading offline — saved version from {new Date(offlineFallback.generated_at).toLocaleString()}
          </div>
        )}
        {!displayReport && !isGenerating && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="mb-4 text-gray-400">Generate a plane-ready AI briefing from your source documents.</p>
            <button
              onClick={handleGenerate}
              className="rounded-xl bg-purple-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-purple-500"
            >
              Generate Report
            </button>
          </div>
        )}
        {isGenerating && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Loader2 size={24} className="mb-3 animate-spin text-purple-400" />
            <p className="text-sm text-gray-400">Synthesizing briefing report…</p>
            <p className="mt-1 text-xs text-gray-600">
              Runs in the background — typically 3–5 minutes. Safe to close this tab; come back any time.
            </p>
          </div>
        )}
        {displayReport && !isGenerating && (
          <div className="mx-auto max-w-3xl">
            <ReportRenderer markdown={displayReport.content_md} />
          </div>
        )}
      </div>
    </div>
  )
}

function ReportRenderer({ markdown }: { markdown: string }): ReactNode {
  const lines = markdown.split('\n')
  const out: ReactNode[] = []
  let key = 0

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '')

    if (!line.trim()) {
      out.push(<div key={key++} className="h-3" />)
      continue
    }

    if (line.startsWith('# ')) {
      out.push(
        <h1 key={key++} className="mb-4 mt-2 text-2xl font-bold text-white print:text-black">
          {renderInline(line.slice(2))}
        </h1>
      )
      continue
    }

    if (line.startsWith('## ')) {
      out.push(
        <h2 key={key++} className="mb-2 mt-6 text-base font-semibold text-gray-100 print:text-black">
          {renderInline(line.slice(3))}
        </h2>
      )
      continue
    }

    if (line.startsWith('### ')) {
      out.push(
        <h3 key={key++} className="mb-1 mt-4 text-sm font-semibold uppercase tracking-wide text-gray-400 print:text-gray-600">
          {renderInline(line.slice(4))}
        </h3>
      )
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const m = line.match(/^(\d+)\.\s+(.*)$/)
      if (m) {
        out.push(
          <div key={key++} className="flex gap-3 py-0.5 text-sm leading-relaxed text-gray-200 print:text-black">
            <span className="w-5 flex-shrink-0 text-right font-medium text-gray-500 print:text-gray-400">{m[1]}.</span>
            <span>{renderInline(m[2])}</span>
          </div>
        )
        continue
      }
    }

    if (/^[-*]\s+/.test(line)) {
      out.push(
        <div key={key++} className="flex gap-3 py-0.5 text-sm leading-relaxed text-gray-200 print:text-black">
          <span className="mt-2.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-500 print:bg-gray-400" />
          <span>{renderInline(line.replace(/^[-*]\s+/, ''))}</span>
        </div>
      )
      continue
    }

    if (line === '---' || line === '***') {
      out.push(<hr key={key++} className="my-4 border-gray-800 print:border-gray-300" />)
      continue
    }

    out.push(
      <p key={key++} className="py-0.5 text-sm leading-relaxed text-gray-200 print:text-black">
        {renderInline(line)}
      </p>
    )
  }

  return <div className="report-content">{out}</div>
}

function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = []
  let key = 0
  const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    if (match[2]) {
      parts.push(<strong key={key++} className="font-semibold text-white print:text-black">{match[2]}</strong>)
    } else if (match[3]) {
      parts.push(<em key={key++} className="italic">{match[3]}</em>)
    } else if (match[4]) {
      parts.push(<code key={key++} className="rounded bg-black/30 px-1 py-0.5 text-xs print:bg-gray-100">{match[4]}</code>)
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length > 0 ? parts : text
}
