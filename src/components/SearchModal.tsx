import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, FileText, Calendar } from 'lucide-react'
import { useSearch } from '../hooks/useSearch'

interface SearchModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const { data: results, isLoading } = useSearch(debouncedQuery, isOpen && debouncedQuery.length >= 2)

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  // Reset and focus when modal opens
  useEffect(() => {
    if (isOpen) {
      // Use setTimeout to avoid synchronous setState in effect
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const handleClose = useCallback(() => {
    setQuery('')
    setDebouncedQuery('')
    setSelectedIndex(0)
    onClose()
  }, [onClose])

  const handleSelect = useCallback(
    (resultType: string, resultId: string) => {
      handleClose()
      if (resultType === 'item') {
        navigate(`/items/${resultId}`)
      } else {
        navigate(`/meetings/${resultId}`)
      }
    },
    [navigate, handleClose]
  )

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setSelectedIndex(0)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose()
      return
    }

    if (!results?.length) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selected = results[selectedIndex]
      if (selected) {
        handleSelect(selected.result_type, selected.result_id)
      }
    }
  }

  if (!isOpen) return null

  const highlightSnippet = (snippet: string) => {
    const parts = snippet.split(/\*\*/g)
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <mark key={i} className="bg-purple-500/30 text-purple-200">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      )
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={handleClose}>
      <div className="fixed inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-xl rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-3">
          <Search size={18} className="text-gray-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search items, meetings..."
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
          />
          <kbd className="rounded border border-gray-700 px-1.5 py-0.5 text-xs text-gray-500">esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-2">
          {isLoading && debouncedQuery.length >= 2 && (
            <div className="px-4 py-6 text-center text-sm text-gray-500">Searching...</div>
          )}

          {!isLoading && results && results.length === 0 && debouncedQuery.length >= 2 && (
            <div className="px-4 py-6 text-center text-sm text-gray-500">
              No results for &ldquo;{debouncedQuery}&rdquo;
            </div>
          )}

          {results?.map((result, i) => (
            <button
              key={result.result_id}
              onClick={() => handleSelect(result.result_type, result.result_id)}
              className={`flex w-full items-start gap-3 px-4 py-2.5 text-left ${
                i === selectedIndex ? 'bg-gray-800' : 'hover:bg-gray-800/50'
              }`}
            >
              {result.result_type === 'item' ? (
                <FileText size={16} className="mt-0.5 flex-shrink-0 text-gray-500" />
              ) : (
                <Calendar size={16} className="mt-0.5 flex-shrink-0 text-gray-500" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-white">{result.title}</span>
                  {result.stream_name && (
                    <span className="flex-shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
                      {result.stream_name}
                    </span>
                  )}
                  {result.status && (
                    <span className="flex-shrink-0 text-xs text-gray-500">{result.status}</span>
                  )}
                </div>
                {result.snippet && (
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {highlightSnippet(result.snippet)}
                  </p>
                )}
              </div>
            </button>
          ))}

          {!debouncedQuery && (
            <div className="px-4 py-6 text-center text-sm text-gray-500">
              Type to search across items and meetings
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
