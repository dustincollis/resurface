import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X, Link as LinkIcon } from 'lucide-react'
import { useItemLinks, useCreateItemLink, useDeleteItemLink } from '../hooks/useItemLinks'
import { useSearch } from '../hooks/useSearch'
import type { LinkType, ItemLink } from '../lib/types'

const LINK_TYPE_LABELS: Record<LinkType, string> = {
  related: 'Related',
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  parent: 'Parent',
  follow_up: 'Follow-up',
}

const LINK_TYPE_COLORS: Record<LinkType, string> = {
  related: 'bg-gray-700 text-gray-300',
  blocks: 'bg-red-900/50 text-red-300',
  blocked_by: 'bg-orange-900/50 text-orange-300',
  parent: 'bg-blue-900/50 text-blue-300',
  follow_up: 'bg-purple-900/50 text-purple-300',
}

function getLinkedItem(link: ItemLink, currentItemId: string) {
  if (link.source_item_id === currentItemId) {
    return { item: link.target_item, type: link.link_type }
  }
  // Flip the label for reverse direction
  const flippedType: Record<string, LinkType> = {
    blocks: 'blocked_by',
    blocked_by: 'blocks',
  }
  return {
    item: link.source_item,
    type: (flippedType[link.link_type] ?? link.link_type) as LinkType,
  }
}

export default function ItemLinkSection({ itemId }: { itemId: string }) {
  const navigate = useNavigate()
  const { data: links } = useItemLinks(itemId)
  const createLink = useCreateItemLink()
  const deleteLink = useDeleteItemLink()
  const [showForm, setShowForm] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [linkType, setLinkType] = useState<LinkType>('related')
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: searchResults } = useSearch(debouncedQuery, showForm && debouncedQuery.length >= 2)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const handleAdd = (targetId: string) => {
    createLink.mutate({
      source_item_id: itemId,
      target_item_id: targetId,
      link_type: linkType,
    })
    setShowForm(false)
    setSearchQuery('')
    setDebouncedQuery('')
  }

  const handleDelete = (link: ItemLink) => {
    deleteLink.mutate({
      id: link.id,
      source_item_id: link.source_item_id,
      target_item_id: link.target_item_id,
    })
  }

  // Filter search results to only items (not meetings) and exclude self
  const filteredResults = searchResults
    ?.filter((r) => r.result_type === 'item' && r.result_id !== itemId)
    ?? []

  if (!links || links.length === 0) {
    if (!showForm) {
      return (
        <div className="border-b border-gray-800 px-6 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-300">Linked Items</h3>
            <button
              onClick={() => {
                setShowForm(true)
                setTimeout(() => inputRef.current?.focus(), 50)
              }}
              className="text-gray-500 hover:text-purple-400"
            >
              <Plus size={16} />
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-600">No linked items</p>
        </div>
      )
    }
  }

  return (
    <div className="border-b border-gray-800 px-6 py-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300">Linked Items</h3>
        <button
          onClick={() => {
            setShowForm(!showForm)
            if (!showForm) setTimeout(() => inputRef.current?.focus(), 50)
          }}
          className="text-gray-500 hover:text-purple-400"
        >
          {showForm ? <X size={16} /> : <Plus size={16} />}
        </button>
      </div>

      {/* Existing links */}
      {links && links.length > 0 && (
        <div className="mt-2 space-y-1">
          {links.map((link) => {
            const { item, type } = getLinkedItem(link, itemId)
            if (!item) return null
            return (
              <div key={link.id} className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${LINK_TYPE_COLORS[type]}`}>
                  {LINK_TYPE_LABELS[type]}
                </span>
                <button
                  onClick={() => navigate(`/items/${item.id}`)}
                  className="flex-1 truncate text-left text-sm text-gray-300 hover:text-white"
                >
                  <LinkIcon size={12} className="mr-1 inline" />
                  {item.title}
                </button>
                <button
                  onClick={() => handleDelete(link)}
                  className="text-gray-600 hover:text-red-400"
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Add link form */}
      {showForm && (
        <div className="mt-3 space-y-2 rounded-lg border border-gray-700 bg-gray-800 p-3">
          <div className="flex gap-2">
            <select
              value={linkType}
              onChange={(e) => setLinkType(e.target.value as LinkType)}
              className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-white focus:border-purple-500 focus:outline-none"
            >
              {Object.entries(LINK_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for an item..."
              className="flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
          </div>
          {filteredResults.length > 0 && (
            <div className="max-h-32 overflow-y-auto">
              {filteredResults.map((result) => (
                <button
                  key={result.result_id}
                  onClick={() => handleAdd(result.result_id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-700"
                >
                  {result.title}
                  {result.stream_name && (
                    <span className="text-xs text-gray-500">{result.stream_name}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
