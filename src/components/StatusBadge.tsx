import type { ItemStatus } from '../lib/types'

// Outlined, uppercase, monospace chip. Border inherits the text color so
// each status gets a single-color treatment (text + border match). This is
// the base chip style used across the app — filled pills have been retired
// in favor of this editorial-voice form.
const statusConfig: Record<ItemStatus, { label: string; className: string }> = {
  open: { label: 'Open', className: 'text-gray-400' },
  in_progress: { label: 'In progress', className: 'text-cyan-300' },
  waiting: { label: 'Waiting', className: 'text-amber-300' },
  done: { label: 'Done', className: 'text-green-400' },
  dropped: { label: 'Dropped', className: 'text-red-400' },
}

export default function StatusBadge({ status }: { status: ItemStatus }) {
  const config = statusConfig[status]
  return (
    <span
      className={`inline-flex rounded border border-current px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${config.className}`}
    >
      {config.label}
    </span>
  )
}
