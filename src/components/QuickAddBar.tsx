import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import { useCreateItem } from '../hooks/useItems'
import { useStreams } from '../hooks/useStreams'
import { parseQuickAdd } from '../lib/parseQuickAdd'

interface QuickAddBarProps {
  defaultStreamId?: string
  compact?: boolean
}

export default function QuickAddBar({ defaultStreamId, compact = false }: QuickAddBarProps) {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [expanded, setExpanded] = useState(!compact)
  const { data: streams } = useStreams()
  const createItem = useCreateItem()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (expanded && compact) {
      inputRef.current?.focus()
    }
  }, [expanded, compact])

  const handleSubmit = () => {
    if (!text.trim()) return

    const parsed = parseQuickAdd(text, streams ?? [])
    createItem.mutate(
      {
        title: parsed.title,
        stream_id: parsed.stream_id ?? defaultStreamId ?? null,
        due_date: parsed.due_date ?? null,
      },
      {
        onSuccess: (newItem) => {
          navigate(`/items/${newItem.id}`)
        },
      }
    )
    setText('')
    if (compact) setExpanded(false)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape' && compact) {
      setText('')
      setExpanded(false)
    }
  }

  // Compact mode: button by default, expands inline on click
  if (compact && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500"
      >
        <Plus size={14} />
        Add Item
      </button>
    )
  }

  if (compact && expanded) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5">
        <Plus size={14} className="text-gray-500" />
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (!text.trim()) setExpanded(false) }}
          placeholder="Add an item... (#stream, due:date)"
          className="w-64 bg-transparent text-xs text-white placeholder-gray-500 outline-none"
        />
        {text.trim() && (
          <button
            onClick={handleSubmit}
            className="rounded bg-purple-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-purple-500"
          >
            Add
          </button>
        )}
        <button
          onClick={() => { setText(''); setExpanded(false) }}
          className="text-gray-500 hover:text-gray-300"
        >
          <X size={12} />
        </button>
      </div>
    )
  }

  // Full bar mode (used elsewhere like StreamDetail)
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
      <Plus size={18} className="text-gray-500" />
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add an item... (#stream, due:date)"
        className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
      />
      {text.trim() && (
        <button
          onClick={handleSubmit}
          className="rounded bg-purple-600 px-3 py-1 text-xs font-medium text-white hover:bg-purple-500"
        >
          Add
        </button>
      )}
    </div>
  )
}
