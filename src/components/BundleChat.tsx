import { useState, useRef, useEffect, type ReactNode, type KeyboardEvent } from 'react'
import { Send, Loader2, Sparkles, User, MapPin, BookOpen, Users, Search } from 'lucide-react'
import { useBundleChat, useSendBundleChatMessage } from '../hooks/useBundleChat'

const STARTER_PROMPTS = [
  {
    label: 'Priority accounts',
    icon: MapPin,
    prompt: 'Which accounts should I prioritize at this event, and why? What are the key things to know about each?',
  },
  {
    label: 'Day-by-day plan',
    icon: BookOpen,
    prompt: 'Walk me through the schedule day by day. What are the key meetings, meals, and conflicts to know about?',
  },
  {
    label: 'Who to find',
    icon: Users,
    prompt: 'Who are the most important people to connect with at this event? What do I need to know about each?',
  },
  {
    label: 'Conflicts & gaps',
    icon: Search,
    prompt: 'What scheduling conflicts exist, and what are the open gaps or unresolved questions I should know about?',
  },
]

export default function BundleChat({ bundleId }: { bundleId: string }) {
  const { data: messages, isLoading } = useBundleChat(bundleId)
  const send = useSendBundleChatMessage()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, send.isPending])

  const handleSend = (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || send.isPending) return
    setError(null)
    send.mutate(
      { bundleId, message: content },
      {
        onSuccess: () => {
          setInput('')
          setTimeout(() => inputRef.current?.focus(), 50)
        },
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      }
    )
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isEmpty = !isLoading && (!messages || messages.length === 0)

  return (
    <div className="flex h-full flex-col">
      {/* Message thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 pb-2">
        {isEmpty ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Ask anything about this bundle — schedule, accounts, people, talking points, or gaps.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STARTER_PROMPTS.map((sp) => {
                const Icon = sp.icon
                return (
                  <button
                    key={sp.label}
                    onClick={() => handleSend(sp.prompt)}
                    disabled={send.isPending}
                    className="flex flex-col items-start gap-1.5 rounded-xl border border-gray-800 bg-gray-900/60 p-3 text-left transition-colors hover:border-purple-700/50 hover:bg-gray-900 disabled:opacity-50"
                  >
                    <Icon size={14} className="text-purple-400" />
                    <span className="text-xs font-medium text-gray-200">{sp.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages?.map((msg) => (
              <ChatBubble key={msg.id} role={msg.role} content={msg.content} />
            ))}
            {send.isPending && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Loader2 size={12} className="animate-spin" />
                Searching bundle + Resurface...
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-gray-800 p-4 pt-3">
        {error && (
          <div className="mb-2 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about schedule, accounts, people, or anything in the briefing..."
            rows={1}
            disabled={send.isPending}
            className="flex-1 resize-none rounded-xl border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none disabled:opacity-50"
            style={{ maxHeight: '120px' }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || send.isPending}
            className="flex-shrink-0 rounded-xl bg-purple-600 p-2.5 text-white hover:bg-purple-500 disabled:opacity-50"
            title="Send (Enter)"
          >
            {send.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}

function ChatBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const isUser = role === 'user'
  return (
    <div className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-purple-900/50 text-purple-300">
          <Sparkles size={12} />
        </div>
      )}
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm ${
          isUser
            ? 'bg-purple-900/40 text-purple-100 border border-purple-800/40'
            : 'bg-gray-800/80 text-gray-100'
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm">{content}</div>
        ) : (
          <MarkdownRenderer text={content} />
        )}
      </div>
      {isUser && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-700 text-gray-300">
          <User size={12} />
        </div>
      )}
    </div>
  )
}

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
    if (line.startsWith('### ')) {
      out.push(
        <h4 key={key++} className="mt-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          {renderInline(line.slice(4))}
        </h4>
      )
      continue
    }
    if (line.startsWith('## ')) {
      out.push(
        <h3 key={key++} className="mt-3 text-sm font-semibold text-gray-100">
          {renderInline(line.slice(3))}
        </h3>
      )
      continue
    }
    if (line.startsWith('# ')) {
      out.push(
        <h2 key={key++} className="mt-3 text-sm font-bold text-white">
          {renderInline(line.slice(2))}
        </h2>
      )
      continue
    }
    if (/^\d+\.\s+/.test(line)) {
      const m = line.match(/^(\d+)\.\s+(.*)$/)
      if (m) {
        out.push(
          <div key={key++} className="flex gap-2 pl-1 text-sm leading-relaxed">
            <span className="flex-shrink-0 font-medium text-gray-500">{m[1]}.</span>
            <span>{renderInline(m[2])}</span>
          </div>
        )
        continue
      }
    }
    if (/^[-*]\s+/.test(line)) {
      out.push(
        <div key={key++} className="flex gap-2 pl-1 text-sm leading-relaxed">
          <span className="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-gray-500" />
          <span>{renderInline(line.replace(/^[-*]\s+/, ''))}</span>
        </div>
      )
      continue
    }
    // Citation lines like [Section Name]
    if (/^\[.+\]/.test(line)) {
      out.push(
        <p key={key++} className="mt-1 text-xs text-purple-400/80">{renderInline(line)}</p>
      )
      continue
    }
    out.push(<p key={key++} className="text-sm leading-relaxed">{renderInline(line)}</p>)
  }
  return <>{out}</>
}

function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = []
  let key = 0
  const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\])/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    if (match[2]) {
      parts.push(<strong key={key++} className="font-semibold text-white">{match[2]}</strong>)
    } else if (match[3]) {
      parts.push(<em key={key++} className="italic">{match[3]}</em>)
    } else if (match[4]) {
      parts.push(<code key={key++} className="rounded bg-black/40 px-1 py-0.5 text-xs">{match[4]}</code>)
    } else if (match[5]) {
      // [Citation] — render as a subtle chip
      parts.push(
        <span key={key++} className="inline-block rounded bg-purple-900/30 px-1.5 py-0.5 text-xs text-purple-400">
          {match[5]}
        </span>
      )
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length > 0 ? parts : text
}
