import { useState, type KeyboardEvent } from 'react'
import { Plus } from 'lucide-react'
import { useCreateItem } from '../hooks/useItems'
import { useStreams } from '../hooks/useStreams'
import { parseQuickAdd } from '../lib/parseQuickAdd'

interface QuickAddBarProps {
  defaultStreamId?: string
}

export default function QuickAddBar({ defaultStreamId }: QuickAddBarProps) {
  const [text, setText] = useState('')
  const { data: streams } = useStreams()
  const createItem = useCreateItem()

  const handleSubmit = () => {
    if (!text.trim()) return

    const parsed = parseQuickAdd(text, streams ?? [])
    createItem.mutate({
      title: parsed.title,
      stream_id: parsed.stream_id ?? defaultStreamId ?? null,
      due_date: parsed.due_date ?? null,
    })
    setText('')
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

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
