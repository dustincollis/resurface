import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Archive, List, Columns, FileQuestion } from 'lucide-react'
import { useStream, useUpdateStream, useArchiveStream } from '../hooks/useStreams'
import { useItemsByStream, useUncategorizedItems, useUpdateItem } from '../hooks/useItems'
import ItemCard from '../components/ItemCard'
import KanbanBoard from '../components/KanbanBoard'
import QuickAddBar from '../components/QuickAddBar'
import StreamFormModal from '../components/StreamFormModal'
import { sortByPriority } from '../lib/priorityScore'
import type { CreateStreamPayload, ItemStatus } from '../lib/types'

export default function StreamDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isUncategorized = id === 'uncategorized'

  const { data: stream, isLoading: streamLoading } = useStream(isUncategorized ? '' : id!)
  const { data: streamItems, isLoading: streamItemsLoading } = useItemsByStream(
    isUncategorized ? '' : id!
  )
  const { data: uncategorizedItems, isLoading: uncategorizedLoading } = useUncategorizedItems()

  const items = isUncategorized ? uncategorizedItems : streamItems
  const itemsLoading = isUncategorized ? uncategorizedLoading : streamItemsLoading

  const updateStream = useUpdateStream()
  const updateItem = useUpdateItem()
  const archiveStream = useArchiveStream()
  const [showEditModal, setShowEditModal] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list')

  if (!isUncategorized && (streamLoading || !stream)) {
    return <div className="text-gray-400">Loading...</div>
  }

  const handleEdit = (payload: CreateStreamPayload) => {
    if (!stream) return
    updateStream.mutate({ id: stream.id, ...payload })
    setShowEditModal(false)
  }

  const handleArchive = () => {
    if (!stream) return
    archiveStream.mutate(stream.id)
    navigate('/streams')
  }

  const handleStatusChange = (itemId: string, newStatus: ItemStatus) => {
    const completed_at = (newStatus === 'done' || newStatus === 'dropped')
      ? new Date().toISOString()
      : null
    updateItem.mutate({ id: itemId, status: newStatus, completed_at })
  }

  const activeItems = sortByPriority(items?.filter(i => !['done', 'dropped'].includes(i.status)) ?? [])
  const completedItems = items?.filter(i => ['done', 'dropped'].includes(i.status)) ?? []

  return (
    <div className={viewMode === 'kanban' ? '' : 'mx-auto max-w-3xl'}>
      <button
        onClick={() => navigate('/streams')}
        className="mb-4 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"
      >
        <ArrowLeft size={16} /> Back to Streams
      </button>

      <div className="mb-6 flex items-center gap-3">
        {isUncategorized ? (
          <>
            <FileQuestion size={20} className="text-gray-500" />
            <h1 className="flex-1 text-2xl font-semibold italic text-white">Uncategorized</h1>
          </>
        ) : (
          <>
            <div
              className="h-4 w-4 rounded-full"
              style={{ backgroundColor: stream!.color }}
            />
            <h1 className="flex-1 text-2xl font-semibold text-white">{stream!.name}</h1>
          </>
        )}

        {/* View toggle */}
        <div className="flex rounded-lg border border-gray-700">
          <button
            onClick={() => setViewMode('list')}
            className={`rounded-l-lg p-2 ${
              viewMode === 'list' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
            title="List view"
          >
            <List size={16} />
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={`rounded-r-lg p-2 ${
              viewMode === 'kanban' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
            title="Kanban view"
          >
            <Columns size={16} />
          </button>
        </div>

        {!isUncategorized && (
          <>
            <button
              onClick={() => setShowEditModal(true)}
              className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              title="Edit stream"
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={handleArchive}
              className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-red-400"
              title="Archive stream"
            >
              <Archive size={16} />
            </button>
          </>
        )}
      </div>

      {isUncategorized ? (
        <p className="mb-4 text-xs text-gray-500">
          Tasks created without a stream. Open each one to assign it to a stream and clear the backlog.
        </p>
      ) : (
        <QuickAddBar defaultStreamId={id} />
      )}

      {itemsLoading ? (
        <div className="mt-4 text-gray-400">Loading tasks...</div>
      ) : viewMode === 'kanban' ? (
        <div className="mt-6">
          <KanbanBoard
            items={items ?? []}
            onStatusChange={handleStatusChange}
          />
        </div>
      ) : (
        <>
          {activeItems.length > 0 ? (
            <div className="mt-6 space-y-2">
              {activeItems.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-lg border border-dashed border-gray-700 py-8 text-center">
              <p className="text-gray-400">
                {isUncategorized ? 'No uncategorized tasks. Nice work.' : 'No active tasks in this stream.'}
              </p>
            </div>
          )}

          {completedItems.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-3 text-sm font-medium text-gray-500">
                Completed ({completedItems.length})
              </h3>
              <div className="space-y-2 opacity-60">
                {completedItems.map((item) => (
                  <ItemCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showEditModal && stream && (
        <StreamFormModal
          stream={stream}
          onSave={handleEdit}
          onClose={() => setShowEditModal(false)}
        />
      )}
    </div>
  )
}
