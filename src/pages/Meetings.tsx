import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Calendar, FileText, Trash2 } from 'lucide-react'
import { useMeetings, useCreateMeeting, useDeleteMeeting } from '../hooks/useMeetings'
import type { Meeting } from '../hooks/useMeetings'

function groupByDate(meetings: Meeting[]): Map<string, Meeting[]> {
  const groups = new Map<string, Meeting[]>()

  for (const meeting of meetings) {
    const dateKey = meeting.start_time
      ? new Date(meeting.start_time).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      : 'No date'

    const existing = groups.get(dateKey) ?? []
    existing.push(meeting)
    groups.set(dateKey, existing)
  }

  return groups
}

function todayString(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function Meetings() {
  const { data: meetings, isLoading } = useMeetings()
  const createMeeting = useCreateMeeting()
  const deleteMeeting = useDeleteMeeting()
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDate, setNewDate] = useState(todayString())

  const handleCreate = () => {
    if (!newTitle.trim()) return
    // newDate is YYYY-MM-DD; convert to ISO at noon local to avoid TZ off-by-one
    const startTime = newDate
      ? new Date(`${newDate}T12:00:00`).toISOString()
      : undefined
    createMeeting.mutate(
      {
        title: newTitle.trim(),
        start_time: startTime,
      },
      {
        onSuccess: (meeting) => {
          navigate(`/meetings/${meeting.id}`)
          setShowForm(false)
          setNewTitle('')
          setNewDate(todayString())
        },
      }
    )
  }

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    deleteMeeting.mutate(id)
  }

  const grouped = useMemo(() => {
    if (!meetings) return new Map<string, Meeting[]>()
    return groupByDate(meetings)
  }, [meetings])

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Discussions</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
        >
          <Plus size={16} />
          Add Discussion
        </button>
      </div>

      {showForm && (
        <div className="mb-6 space-y-2 rounded-lg border border-gray-700 bg-gray-900 p-4">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Discussion title..."
            className="block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
            />
            <button
              onClick={handleCreate}
              disabled={!newTitle.trim()}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={() => { setShowForm(false); setNewTitle(''); setNewDate(todayString()) }}
              className="rounded-lg px-3 py-2 text-sm text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-gray-400">Loading discussions...</div>
      ) : meetings && meetings.length > 0 ? (
        <div className="space-y-6">
          {[...grouped.entries()].map(([dateLabel, items]) => (
            <section key={dateLabel}>
              <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-gray-500">
                {dateLabel}
              </h2>
              <div className="space-y-2">
                {items.map((meeting) => (
                  <div
                    key={meeting.id}
                    onClick={() => navigate(`/meetings/${meeting.id}`)}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 text-left transition-colors hover:border-gray-700"
                  >
                    <Calendar size={16} className="flex-shrink-0 text-gray-500" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-white">{meeting.title}</div>
                      {meeting.start_time && (
                        <div className="text-xs text-gray-500">
                          {new Date(meeting.start_time).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </div>
                      )}
                    </div>
                    {meeting.transcript_summary && (
                      <FileText size={14} className="flex-shrink-0 text-purple-400" />
                    )}
                    <button
                      onClick={(e) => handleDelete(e, meeting.id)}
                      className="flex-shrink-0 rounded p-1 text-gray-600 hover:bg-gray-800 hover:text-red-400"
                      title="Delete discussion"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-700 py-8 text-center">
          <p className="text-gray-400">No discussions yet. Add one or connect your calendar in Settings.</p>
        </div>
      )}
    </div>
  )
}
