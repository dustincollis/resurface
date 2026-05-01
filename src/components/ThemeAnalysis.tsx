import { useState } from 'react'
import { Sparkles, Loader2, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react'
import {
  useThemeReports,
  useRunThemeAnalysis,
  type ThemeReport,
  type Theme,
  type OneOff,
} from '../hooks/useThemeReports'

// First-cut visual treatment. The user explicitly said they want minimum
// styling for now — list older reports plain, focus on the latest at the
// top. We'll iterate on the visual once the prompt is producing the right
// shape of output.

function fmtTs(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function ThemeBlock({ theme }: { theme: Theme }) {
  const [showEvidence, setShowEvidence] = useState(false)
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <h4 className="text-sm font-semibold text-white">{theme.title}</h4>
      {theme.why_it_matters && (
        <p className="mt-2 text-sm text-gray-300">
          <span className="text-gray-500">Why it matters: </span>
          {theme.why_it_matters}
        </p>
      )}
      {theme.next_move && (
        <p className="mt-1.5 text-sm text-gray-300">
          <span className="text-gray-500">Next move: </span>
          {theme.next_move}
        </p>
      )}
      {theme.evidence.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowEvidence(!showEvidence)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300"
          >
            {showEvidence ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {theme.evidence.length} evidence {theme.evidence.length === 1 ? 'item' : 'items'}
          </button>
          {showEvidence && (
            <ul className="mt-2 space-y-1.5 border-l border-gray-800 pl-3">
              {theme.evidence.map((ev, i) => (
                <li key={i} className="text-xs text-gray-400">
                  <div className="text-gray-300">{ev.quote || '(no quote)'}</div>
                  <div className="text-gray-600">
                    {ev.source_type}
                    {ev.person ? ` · ${ev.person}` : ''}
                    {ev.company ? ` · ${ev.company}` : ''}
                    {ev.meeting_title ? ` · ${ev.meeting_title}` : ''}
                    {ev.meeting_date ? ` · ${ev.meeting_date}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function OneOffBlock({ item }: { item: OneOff }) {
  return (
    <div className="rounded border border-gray-800/60 bg-gray-900/40 px-3 py-2 text-xs">
      <div className="text-sm text-gray-200">{item.signal}</div>
      {item.why_watch && (
        <div className="mt-0.5 text-gray-500">{item.why_watch}</div>
      )}
      <div className="mt-1 text-[11px] text-gray-600">
        {item.source_type}
        {item.meeting_title ? ` · ${item.meeting_title}` : ''}
        {item.meeting_date ? ` · ${item.meeting_date}` : ''}
      </div>
    </div>
  )
}

function ReportBody({ report }: { report: ThemeReport }) {
  const hasContent = report.themes.length > 0 || report.one_offs.length > 0
  return (
    <div className="space-y-4">
      {report.intro && (
        <p className="text-sm leading-relaxed text-gray-300">{report.intro}</p>
      )}
      {report.themes.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            What's reverberating
          </h3>
          <div className="space-y-2.5">
            {report.themes.map((t, i) => (
              <ThemeBlock key={i} theme={t} />
            ))}
          </div>
        </div>
      )}
      {report.one_offs.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            One-offs worth watching
          </h3>
          <div className="space-y-1.5">
            {report.one_offs.map((o, i) => (
              <OneOffBlock key={i} item={o} />
            ))}
          </div>
        </div>
      )}
      {!hasContent && !report.intro && (
        <p className="text-sm text-gray-500">
          Analysis returned no themes — corpus may be too thin or nothing strong is reverberating yet.
        </p>
      )}
      {report.input_summary && (
        <p className="text-[11px] text-gray-700">
          Read {report.input_summary.ideas_count} ideas · {report.input_summary.memories_count} memories · {report.input_summary.commitments_count} commitments
          {report.model ? ` · ${report.model}` : ''}
        </p>
      )}
    </div>
  )
}

export default function ThemeAnalysis() {
  const { data: reports, isLoading } = useThemeReports()
  const run = useRunThemeAnalysis()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const latest = reports && reports.length > 0 ? reports[0] : null
  const older = reports ? reports.slice(1) : []

  return (
    <section className="mb-8 rounded-xl border border-gray-800 bg-gray-950/40 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <Sparkles size={16} className="text-purple-400" />
            What reverberates
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            On-demand AI pass over your ideas, memories, and outgoing commitments.
          </p>
        </div>
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
        >
          {run.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles size={14} />
              {latest ? 'Run again' : 'Run analysis'}
            </>
          )}
        </button>
      </div>

      {run.error && (
        <div className="mb-4 flex items-start gap-2 rounded border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <span>{(run.error as Error).message}</span>
        </div>
      )}

      {isLoading && !reports && (
        <div className="text-sm text-gray-500">Loading...</div>
      )}

      {!isLoading && !latest && !run.isPending && (
        <p className="text-sm text-gray-500">
          No analyses yet. Run one to see what's reverberating across your corpus.
        </p>
      )}

      {latest && (
        <>
          <div className="mb-2 flex items-center gap-2 text-[11px] text-gray-500">
            <span>Latest</span>
            <span>·</span>
            <span>{fmtTs(latest.created_at)}</span>
          </div>
          <ReportBody report={latest} />
        </>
      )}

      {older.length > 0 && (
        <div className="mt-6 border-t border-gray-800 pt-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            Prior analyses ({older.length})
          </h3>
          <div className="space-y-1">
            {older.map((r) => (
              <div key={r.id}>
                <button
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-gray-400 hover:bg-gray-900 hover:text-gray-200"
                >
                  {expandedId === r.id ? (
                    <ChevronDown size={11} />
                  ) : (
                    <ChevronRight size={11} />
                  )}
                  <span className="text-gray-500">{fmtTs(r.created_at)}</span>
                  <span className="text-gray-600">·</span>
                  <span>
                    {r.themes.length} {r.themes.length === 1 ? 'theme' : 'themes'}
                    {r.one_offs.length > 0 ? ` · ${r.one_offs.length} one-offs` : ''}
                  </span>
                </button>
                {expandedId === r.id && (
                  <div className="mt-2 ml-5 mb-3">
                    <ReportBody report={r} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
