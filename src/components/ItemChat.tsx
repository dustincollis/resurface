import { useState, useRef, useEffect, type ReactNode, type KeyboardEvent } from 'react'
import { Sparkles, Compass, Search, FileText, Send, Loader2, User } from 'lucide-react'
import { useItemChat, useSendItemChatMessage } from '../hooks/useItemChat'

interface StarterPrompt {
  label: string
  description: string
  icon: typeof Compass
  prompt: string
}

const STARTER_PROMPTS: StarterPrompt[] = [
  {
    label: 'Approach',
    description: 'How to start, what to gather, who to involve',
    icon: Compass,
    prompt: "How should I approach this? Give me a numbered list of concrete steps starting with the smallest first action.",
  },
  {
    label: 'Context',
    description: "What's been said about this across your meetings",
    icon: Search,
    prompt: "What's been said about this across my meetings, pursuits, and related work? Cite specific source meetings by name.",
  },
  {
    label: 'Draft',
    description: 'A ready-to-use artifact (email, agenda, outline, etc)',
    icon: FileText,
    prompt: "Draft me a ready-to-use artifact for this. Pick the right format (email, agenda, memo, outline, checklist, etc) based on the task. Sign with my real name.",
  },
]

export default function ItemChat({ itemId }: { itemId: string }) {
  const { data: messages, isLoading } = useItemChat(itemId)
  const send = useSendItemChatMessage()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to the latest message whenever messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || send.isPending) return
    setError(null)
    send.mutate(
      { itemId, message: content },
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
    <div className="border-b border-gray-800 px-6 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={14} className="text-purple-400" />
        <h3 className="text-sm font-medium text-gray-300">Help me with this</h3>
        {messages && messages.length > 0 && (
          <span className="text-[11px] text-gray-600">
            {messages.length} message{messages.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {isEmpty ? (
        // Empty state — starter prompts as big buttons
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Pick a starter or type your own question below.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {STARTER_PROMPTS.map((sp) => {
              const Icon = sp.icon
              return (
                <button
                  key={sp.label}
                  onClick={() => handleSend(sp.prompt)}
                  disabled={send.isPending}
                  className="flex flex-col items-start gap-1 rounded-lg border border-gray-800 bg-gray-950/40 p-3 text-left transition-colors hover:border-purple-700/50 hover:bg-gray-900 disabled:opacity-50"
                >
                  <Icon size={14} className="text-purple-400" />
                  <span className="text-xs font-medium text-gray-200">{sp.label}</span>
                  <span className="text-[10px] leading-snug text-gray-500">{sp.description}</span>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        // Populated state — scrollable thread
        <div
          ref={scrollRef}
          className="max-h-[480px] space-y-3 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950/40 p-3"
        >
          {messages?.map((msg) => (
            <ChatBubble key={msg.id} role={msg.role} content={msg.content} />
          ))}
          {send.isPending && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Loader2 size={12} className="animate-spin" />
              Thinking...
            </div>
          )}
        </div>
      )}

      {/* Input — always shown, even in empty state */}
      <div className="mt-3 flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isEmpty ? 'Ask anything about this item...' : 'Continue the conversation...'}
          rows={1}
          disabled={send.isPending}
          className="flex-1 resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none disabled:opacity-50"
          style={{ maxHeight: '160px' }}
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || send.isPending}
          className="rounded-lg bg-purple-600 p-2 text-white hover:bg-purple-500 disabled:opacity-50"
          title="Send (Enter)"
        >
          {send.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>

      {error && (
        <div className="mt-2 rounded border border-red-900/40 bg-red-950/30 px-3 py-2 text-[11px] text-red-300">
          {error}
        </div>
      )}
    </div>
  )
}

function ChatBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const isUser = role === 'user'
  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-purple-900/40 text-purple-300">
          <Sparkles size={11} />
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
          isUser
            ? 'bg-purple-900/40 text-purple-100 border border-purple-800/50'
            : 'bg-gray-800 text-gray-200'
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{content}</div>
        ) : (
          <MarkdownRenderer text={content} />
        )}
      </div>
      {isUser && (
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-700 text-gray-300">
          <User size={11} />
        </div>
      )}
    </div>
  )
}

// Lightweight markdown renderer for assistant responses.
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
        <h4 key={key++} className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-300">
          {renderInline(line.slice(3))}
        </h4>
      )
      continue
    }
    if (line.startsWith('# ')) {
      out.push(
        <h3 key={key++} className="mt-2 text-xs font-semibold text-gray-100">
          {renderInline(line.slice(2))}
        </h3>
      )
      continue
    }
    if (/^\d+\.\s+/.test(line)) {
      const m = line.match(/^(\d+)\.\s+(.*)$/)
      if (m) {
        out.push(
          <div key={key++} className="flex gap-2 pl-1 text-xs">
            <span className="flex-shrink-0 font-medium text-gray-500">{m[1]}.</span>
            <span>{renderInline(m[2])}</span>
          </div>
        )
        continue
      }
    }
    if (/^[-*]\s+/.test(line)) {
      out.push(
        <div key={key++} className="flex gap-2 pl-1 text-xs">
          <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-gray-500" />
          <span>{renderInline(line.replace(/^[-*]\s+/, ''))}</span>
        </div>
      )
      continue
    }
    out.push(<p key={key++} className="text-xs">{renderInline(line)}</p>)
  }
  return <>{out}</>
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
      parts.push(<strong key={key++} className="font-semibold text-white">{match[2]}</strong>)
    } else if (match[3]) {
      parts.push(<em key={key++} className="italic">{match[3]}</em>)
    } else if (match[4]) {
      parts.push(<code key={key++} className="rounded bg-black/40 px-1 py-0.5 text-[10px]">{match[4]}</code>)
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length > 0 ? parts : text
}
