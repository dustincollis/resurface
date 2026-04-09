import { useState, type ReactNode } from 'react'
import { Compass, Search, FileText, Sparkles, Loader2, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react'
import { useItemAssists, useGenerateItemAssist } from '../hooks/useItemAssists'
import type { ItemAssist, ItemAssistType } from '../lib/types'

interface FacetMeta {
  type: ItemAssistType
  label: string
  description: string
  icon: typeof Compass
  emptyHint: string
}

const FACETS: FacetMeta[] = [
  {
    type: 'approach',
    label: 'Approach',
    description: 'How to start, what to gather, who to involve',
    icon: Compass,
    emptyHint: 'Generate a step-by-step approach for this task.',
  },
  {
    type: 'context',
    label: 'Context',
    description: "What's been said about this across your meetings and related work",
    icon: Search,
    emptyHint: 'Pull together what you already know about this from linked meetings, pursuits, and related items.',
  },
  {
    type: 'draft',
    label: 'Draft',
    description: 'A ready-to-use artifact (email, agenda, outline, etc)',
    icon: FileText,
    emptyHint: 'Generate a concrete deliverable you can copy and lightly edit.',
  },
]

export default function ItemAssistsSection({ itemId }: { itemId: string }) {
  const { data: assists } = useItemAssists(itemId)
  const assistsByType = new Map((assists ?? []).map((a) => [a.assist_type, a]))

  return (
    <div className="border-b border-gray-800 px-6 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={14} className="text-purple-400" />
        <h3 className="text-sm font-medium text-gray-300">Help me with this</h3>
      </div>
      <div className="space-y-2">
        {FACETS.map((facet) => (
          <AssistFacet
            key={facet.type}
            facet={facet}
            itemId={itemId}
            existing={assistsByType.get(facet.type) ?? null}
          />
        ))}
      </div>
    </div>
  )
}

interface AssistFacetProps {
  facet: FacetMeta
  itemId: string
  existing: ItemAssist | null
}

function AssistFacet({ facet, itemId, existing }: AssistFacetProps) {
  const generate = useGenerateItemAssist()
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const Icon = facet.icon
  const hasContent = !!existing

  const handleGenerate = () => {
    setError(null)
    generate.mutate(
      { itemId, assistType: facet.type },
      {
        onSuccess: () => setExpanded(true),
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      }
    )
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/40">
      {/* Header — clickable when content exists to expand/collapse */}
      <div
        className={`flex items-center gap-2 px-3 py-2 ${hasContent ? 'cursor-pointer hover:bg-gray-900/50' : ''}`}
        onClick={() => hasContent && setExpanded((e) => !e)}
      >
        <Icon size={13} className="flex-shrink-0 text-purple-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-200">{facet.label}</span>
            {hasContent && (
              <span className="text-[10px] text-gray-600">
                generated {formatRelative(existing.generated_at)}
              </span>
            )}
          </div>
          {!hasContent && (
            <div className="text-[11px] text-gray-500">{facet.description}</div>
          )}
        </div>
        {hasContent ? (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleGenerate()
              }}
              disabled={generate.isPending}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-800 hover:text-gray-300 disabled:opacity-50"
              title="Regenerate"
            >
              {generate.isPending ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <RotateCcw size={10} />
              )}
              Regenerate
            </button>
            {expanded ? (
              <ChevronDown size={13} className="text-gray-600" />
            ) : (
              <ChevronRight size={13} className="text-gray-600" />
            )}
          </>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={generate.isPending}
            className="flex items-center gap-1.5 rounded bg-purple-600/20 px-2 py-1 text-[11px] font-medium text-purple-300 hover:bg-purple-600/30 disabled:opacity-50"
          >
            {generate.isPending ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles size={11} />
                Generate
              </>
            )}
          </button>
        )}
      </div>

      {/* Content — only when expanded */}
      {hasContent && expanded && (
        <div className="border-t border-gray-800 px-3 py-3">
          <div className="prose prose-sm prose-invert max-w-none">
            <MarkdownRenderer text={existing.content} />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border-t border-gray-800 px-3 py-2 text-[11px] text-red-400">
          {error}
        </div>
      )}
    </div>
  )
}

// Lightweight markdown renderer — handles headings, bullets, numbered lists,
// bold, italic, code. Reuses the same approach as MeetingDetail's synopsis.
function MarkdownRenderer({ text }: { text: string }): ReactNode {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let key = 0

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '')
    if (!line.trim()) {
      out.push(<div key={key++} className="h-2" />)
      continue
    }
    if (line.startsWith('## ')) {
      out.push(
        <h4 key={key++} className="mt-3 text-xs font-semibold uppercase tracking-wider text-gray-300">
          {renderInline(line.slice(3))}
        </h4>
      )
      continue
    }
    if (line.startsWith('# ')) {
      out.push(
        <h3 key={key++} className="mt-3 text-sm font-semibold text-gray-200">
          {renderInline(line.slice(2))}
        </h3>
      )
      continue
    }
    if (/^\d+\.\s+/.test(line)) {
      const match = line.match(/^(\d+)\.\s+(.*)$/)
      if (match) {
        out.push(
          <div key={key++} className="flex gap-2 pl-2 text-xs text-gray-300">
            <span className="flex-shrink-0 font-medium text-gray-500">{match[1]}.</span>
            <span>{renderInline(match[2])}</span>
          </div>
        )
        continue
      }
    }
    if (/^[-*]\s+/.test(line)) {
      out.push(
        <div key={key++} className="flex gap-2 pl-2 text-xs text-gray-300">
          <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-gray-600" />
          <span>{renderInline(line.replace(/^[-*]\s+/, ''))}</span>
        </div>
      )
      continue
    }
    out.push(
      <p key={key++} className="text-xs text-gray-300">
        {renderInline(line)}
      </p>
    )
  }
  return <>{out}</>
}

function renderInline(text: string): ReactNode {
  // Match **bold**, *italic*, `code`
  const parts: ReactNode[] = []
  let key = 0
  const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    if (match[2]) {
      parts.push(<strong key={key++} className="font-semibold text-white">{match[2]}</strong>)
    } else if (match[3]) {
      parts.push(<em key={key++} className="italic">{match[3]}</em>)
    } else if (match[4]) {
      parts.push(<code key={key++} className="rounded bg-gray-800 px-1 py-0.5 text-[10px] text-gray-300">{match[4]}</code>)
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length > 0 ? parts : text
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
