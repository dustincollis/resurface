import { useState, useRef, useEffect, type KeyboardEvent } from 'react'

interface InlineEditableProps {
  value: string
  onSave: (value: string) => void
  as?: 'h1' | 'p' | 'span'
  className?: string
  placeholder?: string
  multiline?: boolean
}

export default function InlineEditable({
  value,
  onSave,
  as: Tag = 'span',
  className = '',
  placeholder = 'Click to edit...',
  multiline = false,
}: InlineEditableProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const save = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) {
      onSave(trimmed)
    } else {
      setDraft(value)
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault()
      save()
    }
    if (e.key === 'Escape') {
      setDraft(value)
      setEditing(false)
    }
  }

  if (editing) {
    const inputClassName = `w-full bg-transparent outline-none ring-1 ring-purple-500 rounded px-1 ${className}`

    if (multiline) {
      return (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
          className={`${inputClassName} min-h-[60px] resize-y`}
          rows={3}
        />
      )
    }

    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        className={inputClassName}
      />
    )
  }

  return (
    <Tag
      onClick={() => setEditing(true)}
      className={`cursor-pointer rounded px-1 hover:ring-1 hover:ring-gray-600 ${className} ${
        !value ? 'text-gray-500 italic' : ''
      }`}
    >
      {value || placeholder}
    </Tag>
  )
}
