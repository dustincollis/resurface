import type { ItemStatus } from '../lib/types'

const statusConfig: Record<ItemStatus, { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-gray-700 text-gray-300' },
  in_progress: { label: 'In progress', className: 'bg-blue-900/50 text-blue-300' },
  waiting: { label: 'Waiting', className: 'bg-yellow-900/50 text-yellow-300' },
  done: { label: 'Done', className: 'bg-green-900/50 text-green-300' },
  dropped: { label: 'Dropped', className: 'bg-red-900/50 text-red-300' },
}

export default function StatusBadge({ status }: { status: ItemStatus }) {
  const config = statusConfig[status]
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  )
}
