import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Calendar, FileText } from 'lucide-react'
import { useMeetings, useCreateMeeting } from '../hooks/useMeetings'

export default function Meetings() {
  const { data: meetings, isLoading } = useMeetings()
  const createMeeting = useCreateMeeting()
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const handleCreate = () => {
    if (!newTitle.trim()) return
    createMeeting.mutate(
      { title: newTitle.trim() },
      {
        onSuccess: (meeting) => {
          navigate(`/meetings/${meeting.id}`)
          setShowForm(false)
          setNewTitle('')
        },
      }
    )
  }

  const upcoming = meetings?.filter(
    (m) => m.start_time && new Date(m.start_time) >= new Date()
  ) ?? []

  const past = meetings?.filter(
    (m) => !m.start_time || new Date(m.start_time) < new Date()
  ) ?? []

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Meetings</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
        >
          <Plus size={16} />
          Add Meeting
        </button>
      </div>

      {showForm && (
        <div className="mb-6 flex gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Meeting title..."
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            autoFocus
          />
          <button
            onClick={handleCreate}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
          >
            Create
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="text-gray-400">Loading meetings...</div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-500">
                Upcoming
              </h2>
              <div className="space-y-2">
                {upcoming.map((meeting) => (
                  <MeetingRow key={meeting.id} meeting={meeting} onClick={() => navigate(`/meetings/${meeting.id}`)} />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-500">
              {upcoming.length > 0 ? 'Past' : 'All Meetings'}
            </h2>
            {past.length > 0 ? (
              <div className="space-y-2">
                {past.map((meeting) => (
                  <MeetingRow key={meeting.id} meeting={meeting} onClick={() => navigate(`/meetings/${meeting.id}`)} />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-700 py-8 text-center">
                <p className="text-gray-400">No meetings yet. Add one or connect your calendar in Settings.</p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function MeetingRow({ meeting, onClick }: { meeting: { id: string; title: string; start_time: string | null; transcript: string | null; transcript_summary: string | null }; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 text-left transition-colors hover:border-gray-700"
    >
      <Calendar size={16} className="flex-shrink-0 text-gray-500" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-white">{meeting.title}</div>
        {meeting.start_time && (
          <div className="text-xs text-gray-500">
            {new Date(meeting.start_time).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </div>
        )}
      </div>
      {meeting.transcript_summary && (
        <FileText size={14} className="flex-shrink-0 text-purple-400" />
      )}
    </button>
  )
}
