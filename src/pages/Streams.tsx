import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, GripVertical, Archive } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStreams, useCreateStream, useReorderStreams, useArchiveStream } from '../hooks/useStreams'
import StreamFormModal from '../components/StreamFormModal'
import type { Stream, CreateStreamPayload } from '../lib/types'

function SortableStreamRow({ stream, onArchive }: { stream: Stream; onArchive: (id: string) => void }) {
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: stream.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 hover:border-gray-700"
    >
      <button {...attributes} {...listeners} className="cursor-grab text-gray-600 hover:text-gray-400">
        <GripVertical size={16} />
      </button>
      <div
        className="h-3 w-3 rounded-full"
        style={{ backgroundColor: stream.color }}
      />
      <button
        onClick={() => navigate(`/stream/${stream.id}`)}
        className="flex-1 text-left text-sm font-medium text-white hover:text-purple-300"
      >
        {stream.name}
      </button>
      <span className="text-xs text-gray-500">
        {stream.field_templates.length} field{stream.field_templates.length !== 1 ? 's' : ''}
      </span>
      <button
        onClick={() => onArchive(stream.id)}
        className="text-gray-600 hover:text-red-400"
        title="Archive stream"
      >
        <Archive size={16} />
      </button>
    </div>
  )
}

export default function Streams() {
  const { data: streams, isLoading } = useStreams()
  const createStream = useCreateStream()
  const reorderStreams = useReorderStreams()
  const archiveStream = useArchiveStream()
  const [showModal, setShowModal] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !streams) return

    const oldIndex = streams.findIndex((s) => s.id === active.id)
    const newIndex = streams.findIndex((s) => s.id === over.id)
    const reordered = arrayMove(streams, oldIndex, newIndex)

    reorderStreams.mutate(
      reordered.map((s, i) => ({ id: s.id, sort_order: i }))
    )
  }

  const handleCreate = (payload: CreateStreamPayload) => {
    createStream.mutate(payload)
    setShowModal(false)
  }

  if (isLoading) {
    return <div className="text-gray-400">Loading streams...</div>
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Streams</h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
        >
          <Plus size={16} />
          New Stream
        </button>
      </div>

      {streams && streams.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={streams.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {streams.map((stream) => (
                <SortableStreamRow
                  key={stream.id}
                  stream={stream}
                  onArchive={(id) => archiveStream.mutate(id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-700 py-12 text-center">
          <p className="text-gray-400">No streams yet. Create one to start organizing your work.</p>
        </div>
      )}

      {showModal && (
        <StreamFormModal onSave={handleCreate} onClose={() => setShowModal(false)} />
      )}
    </div>
  )
}
