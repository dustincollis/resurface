import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileUp, ClipboardPaste, SquarePen } from 'lucide-react'

type Order = 'capture' | 'task'
type Align = 'right' | 'bottom-right'

interface AddMenuProps {
  // Where the menu anchors relative to its trigger:
  //   - 'right' — popover appears to the right (used in the sidebar)
  //   - 'bottom-right' — popover drops below, right-aligned (used on Focus toolbar)
  align?: Align
  // Ordering influences which item is first:
  //   - 'capture' — File, Paste, Task (sidebar: you're bringing content in)
  //   - 'task' — Task, File, Paste (Focus toolbar: task-thinking mode)
  order?: Order
  trigger: (props: { onClick: () => void; open: boolean }) => React.ReactNode
}

interface Option {
  key: 'task' | 'file' | 'paste'
  label: string
  blurb: string
  icon: typeof FileUp
  accent: string
  to: string
}

const TASK: Option = {
  key: 'task',
  label: 'Task',
  blurb: 'Write a single task yourself',
  icon: SquarePen,
  accent: 'text-green-400',
  to: '/add?mode=task',
}
const FILE: Option = {
  key: 'file',
  label: 'File',
  blurb: '.eml or image — AI extracts items',
  icon: FileUp,
  accent: 'text-purple-400',
  to: '/add?mode=file',
}
const PASTE: Option = {
  key: 'paste',
  label: 'Paste',
  blurb: 'Slack, email body, any text',
  icon: ClipboardPaste,
  accent: 'text-blue-400',
  to: '/add?mode=paste',
}

export default function AddMenu({ align = 'bottom-right', order = 'capture', trigger }: AddMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const options: Option[] = order === 'task' ? [TASK, FILE, PASTE] : [FILE, PASTE, TASK]

  const alignClass =
    align === 'right'
      ? 'left-full top-0 ml-2'
      : 'top-full right-0 mt-1'

  return (
    <div ref={rootRef} className="relative">
      {trigger({ onClick: () => setOpen(!open), open })}
      {open && (
        <div
          className={`absolute z-50 w-64 overflow-hidden rounded-xl border border-gray-700 bg-gray-900 p-1 shadow-2xl ${alignClass}`}
        >
          {options.map((opt) => {
            const Icon = opt.icon
            return (
              <button
                key={opt.key}
                onClick={() => {
                  setOpen(false)
                  navigate(opt.to)
                }}
                className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-gray-800"
              >
                <div className={`mt-0.5 flex-shrink-0 rounded-md bg-gray-950 p-1.5 ${opt.accent}`}>
                  <Icon size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-100">{opt.label}</div>
                  <div className="truncate text-[11px] text-gray-500">{opt.blurb}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
