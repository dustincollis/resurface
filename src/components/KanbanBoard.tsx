import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Calendar } from 'lucide-react'
import type { Item, ItemStatus } from '../lib/types'

const COLUMNS: { status: ItemStatus; label: string; color: string }[] = [
  { status: 'open', label: 'Open', color: 'border-gray-600' },
  { status: 'in_progress', label: 'In Progress', color: 'border-blue-600' },
  { status: 'waiting', label: 'Waiting', color: 'border-yellow-600' },
  { status: 'done', label: 'Done', color: 'border-green-600' },
]

function stalenessColor(score: number): string {
  if (score < 20) return 'bg-green-500'
  if (score < 40) return 'bg-yellow-500'
  if (score < 60) return 'bg-orange-500'
  return 'bg-red-500'
}

interface KanbanCardProps {
  item: Item
  isDragging?: boolean
}

function KanbanCardContent({ item, isDragging }: KanbanCardProps) {
  const navigate = useNavigate()
  const isDue = item.due_date && new Date(item.due_date) <= new Date()

  return (
    <div
      onClick={() => !isDragging && navigate(`/items/${item.id}`)}
      className={`cursor-pointer rounded-lg border border-gray-700 bg-gray-800 p-3 transition-colors hover:border-gray-600 ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      <div className="text-sm font-medium text-white">{item.title}</div>
      {item.next_action && (
        <div className="mt-1 truncate text-xs text-gray-500">Next: {item.next_action}</div>
      )}
      <div className="mt-2 flex items-center gap-2">
        {/* Staleness heat bar */}
        <div className="h-1 w-8 overflow-hidden rounded-full bg-gray-700">
          <div
            className={`h-full rounded-full ${stalenessColor(item.staleness_score)} ${
              item.staleness_score >= 60 ? 'animate-pulse' : ''
            }`}
            style={{ width: `${Math.min(item.staleness_score, 100)}%` }}
          />
        </div>
        {item.due_date && (
          <span className={`flex items-center gap-0.5 text-xs ${isDue ? 'text-red-400' : 'text-gray-500'}`}>
            <Calendar size={10} />
            {new Date(item.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
    </div>
  )
}

function SortableCard({ item }: { item: Item }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { status: item.status },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <KanbanCardContent item={item} isDragging={isDragging} />
    </div>
  )
}

function KanbanColumn({ status, label, color, items }: {
  status: ItemStatus
  label: string
  color: string
  items: Item[]
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[200px] flex-1 flex-col rounded-lg border-t-2 bg-gray-900/50 ${color} ${
        isOver ? 'ring-1 ring-purple-500/50' : ''
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
          {label}
        </span>
        <span className="text-xs text-gray-600">{items.length}</span>
      </div>
      <div className="flex-1 space-y-2 px-2 pb-2">
        {items.map((item) => (
          <SortableCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}

interface KanbanBoardProps {
  items: Item[]
  onStatusChange: (itemId: string, newStatus: ItemStatus) => void
}

export default function KanbanBoard({ items, onStatusChange }: KanbanBoardProps) {
  const [activeItem, setActiveItem] = useState<Item | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const itemsByStatus = (status: ItemStatus) =>
    items
      .filter((i) => i.status === status)
      .sort((a, b) => b.staleness_score - a.staleness_score)

  const handleDragStart = (event: DragStartEvent) => {
    const item = items.find((i) => i.id === event.active.id)
    setActiveItem(item ?? null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveItem(null)
    const { active, over } = event
    if (!over) return

    const itemId = active.id as string
    const item = items.find((i) => i.id === itemId)
    if (!item) return

    // Determine target status: either dropped on a column or on another card
    let targetStatus: ItemStatus
    if (COLUMNS.some((c) => c.status === over.id)) {
      targetStatus = over.id as ItemStatus
    } else {
      // Dropped on a card — find that card's status
      const targetItem = items.find((i) => i.id === over.id)
      if (!targetItem) return
      targetStatus = targetItem.status
    }

    if (targetStatus !== item.status) {
      onStatusChange(itemId, targetStatus)
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3">
        {COLUMNS.map(({ status, label, color }) => (
          <KanbanColumn
            key={status}
            status={status}
            label={label}
            color={color}
            items={itemsByStatus(status)}
          />
        ))}
      </div>

      <DragOverlay>
        {activeItem && (
          <div className="w-64">
            <KanbanCardContent item={activeItem} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
