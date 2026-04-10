import React, { useState, useRef, useEffect } from 'react'
import { Sparkles, Send, Loader2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

interface ChatMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export default function GoalChat({ goalId }: { goalId: string }) {
  const qc = useQueryClient()
  const [input, setInput] = useState('')
  const [expanded, setExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: messages } = useQuery({
    queryKey: ['goal_chat', goalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, role, content, created_at')
        .eq('scope_type', 'goal')
        .eq('scope_id', goalId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as ChatMsg[]
    },
  })

  const sendMessage = useMutation({
    mutationFn: async (message: string) => {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-goal-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ goal_id: goalId, message }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goal_chat', goalId] })
      qc.invalidateQueries({ queryKey: ['goal_tasks', goalId] })
      qc.invalidateQueries({ queryKey: ['goals'] })
    },
  })

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, sendMessage.isPending])

  const handleSend = () => {
    const msg = input.trim()
    if (!msg || sendMessage.isPending) return
    setInput('')
    setExpanded(true)
    sendMessage.mutate(msg)
  }

  const starters = [
    "Help me plan milestones for this goal",
    "I need to meet with key stakeholders and get alignment",
    "Break this into quarterly checkpoints",
  ]

  if (!expanded && (!messages || messages.length === 0)) {
    return (
      <div className="border-t border-gray-800 px-6 py-4">
        <button
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-purple-800/30 bg-purple-950/10 px-4 py-3 text-sm text-purple-300 transition-colors hover:border-purple-700/50 hover:bg-purple-950/20"
        >
          <Sparkles size={16} />
          Plan milestones with AI
        </button>
      </div>
    )
  }

  return (
    <div className="border-t border-gray-800">
      <div className="px-6 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-purple-300">
          <Sparkles size={12} />
          Goal Planner
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="max-h-80 space-y-3 overflow-y-auto px-6"
      >
        {(!messages || messages.length === 0) && !sendMessage.isPending && (
          <div className="space-y-2 py-2">
            <p className="text-xs text-gray-500">
              Describe what you want to accomplish and I'll propose milestones with the right tracking types.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {starters.map((s) => (
                <button
                  key={s}
                  onClick={() => { setInput(s); }}
                  className="rounded-lg border border-gray-800 bg-gray-950/40 px-2.5 py-1.5 text-[11px] text-gray-400 hover:border-gray-700 hover:text-gray-300"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {(messages ?? []).map((msg) => (
          <div
            key={msg.id}
            className={`rounded-lg px-3 py-2 text-sm ${
              msg.role === 'user'
                ? 'ml-8 bg-purple-900/20 text-gray-200'
                : 'mr-4 bg-gray-800/50 text-gray-300'
            }`}
          >
            {msg.role === 'assistant' ? (
              <div className="space-y-1.5">
                {msg.content.split('\n').map((line, i) => {
                  const t = line.trim()
                  if (!t) return <br key={i} />
                  if (t.startsWith('```milestones')) return null
                  if (t.startsWith('```') || t === '```') return null
                  if (t.startsWith('**Milestone:')) {
                    return (
                      <div key={i} className="mt-2 flex items-center gap-1.5 text-sm font-medium text-purple-300">
                        <Sparkles size={10} />
                        {t.replace(/\*\*/g, '')}
                      </div>
                    )
                  }
                  if (t.startsWith('**') && t.endsWith('**')) {
                    return <div key={i} className="mt-2 text-xs font-semibold text-gray-300">{t.replace(/\*\*/g, '')}</div>
                  }
                  if (t.startsWith('- ') || t.startsWith('* ')) {
                    return <div key={i} className="flex gap-1.5 text-xs"><span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-gray-600" />{renderBold(t.slice(2))}</div>
                  }
                  // Skip JSON lines inside milestones block
                  if (t.startsWith('[') || t.startsWith('{') || t.startsWith('"')) {
                    // Check if it looks like the milestones JSON
                    if (t.includes('condition_type') || t.includes('linked_entity_id')) return null
                  }
                  return <p key={i} className="text-xs">{renderBold(t)}</p>
                })}
              </div>
            ) : (
              <span>{msg.content}</span>
            )}
          </div>
        ))}

        {sendMessage.isPending && (
          <div className="flex items-center gap-2 rounded-lg bg-gray-800/50 px-3 py-2 mr-4">
            <Loader2 size={14} className="animate-spin text-purple-400" />
            <span className="text-xs text-gray-400">Planning milestones...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-6 py-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Describe what you want to accomplish..."
          disabled={sendMessage.isPending}
          className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sendMessage.isPending}
          className="flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-500 disabled:opacity-50"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}

function renderBold(text: string) {
  const parts: (string | React.ReactElement)[] = []
  const regex = /\*\*([^*]+)\*\*/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push(<strong key={key++} className="font-semibold text-gray-200">{match[1]}</strong>)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
