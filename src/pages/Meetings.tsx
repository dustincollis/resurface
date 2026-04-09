import { useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Calendar, FileText, Trash2, Upload, Archive, Radio, Loader2, Check, X, AlertCircle, Link2 } from 'lucide-react'
import {
  useMeetings,
  useCreateMeeting,
  useDeleteMeeting,
  useUploadTranscript,
  type MeetingImportMode,
} from '../hooks/useMeetings'
import type { Meeting } from '../hooks/useMeetings'
import { supabase } from '../lib/supabase'

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

// Detect if a string contains a HiNotes share URL. Matches both /s/ and /v/.
function isHiNotesUrl(text: string): boolean {
  return /hinotes\.hidock\.com\/[sv]\/[A-Za-z0-9_-]+/.test(text)
}

// Try to extract a date from a filename. Supports:
//   - HDA-style: 20260407-135959-Rec52.hda → 2026-04-07T13:59:59
//   - Date prefix: 2026-04-07_meeting.txt   → 2026-04-07T12:00:00
//   - Embedded:   meeting_2026-04-07.txt    → 2026-04-07T12:00:00
// Returns ISO string at noon local if only the date is known.
function extractDateFromFilename(filename: string): string | null {
  const hda = filename.match(/^(\d{4})(\d{2})(\d{2})[-_](\d{2})(\d{2})(\d{2})/)
  if (hda) {
    const [, y, mo, d, h, mi, s] = hda
    const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`)
    return isNaN(dt.getTime()) ? null : dt.toISOString()
  }
  const isoLike = filename.match(/(\d{4})[-_](\d{2})[-_](\d{2})/)
  if (isoLike) {
    const [, y, mo, d] = isoLike
    const dt = new Date(`${y}-${mo}-${d}T12:00:00`)
    return isNaN(dt.getTime()) ? null : dt.toISOString()
  }
  return null
}

// Strip extension and tidy filename for use as a placeholder meeting title.
// The AI will replace this after parse, so it just needs to be non-empty
// and recognizable in case the parse fails.
function placeholderTitleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').trim() || 'Untitled discussion'
}

interface BatchEntry {
  id: string
  filename: string
  size: number
  status: 'queued' | 'uploading' | 'parsing' | 'done' | 'error'
  error?: string
  meetingId?: string
}

export default function Meetings() {
  const { data: meetings, isLoading } = useMeetings()
  const createMeeting = useCreateMeeting()
  const deleteMeeting = useDeleteMeeting()
  const uploadTranscript = useUploadTranscript()
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDate, setNewDate] = useState(todayString())
  const [newTranscript, setNewTranscript] = useState('')
  const [newMode, setNewMode] = useState<MeetingImportMode>('active')
  const [singleSubmitting, setSingleSubmitting] = useState(false)
  const [singleError, setSingleError] = useState<string | null>(null)

  // Bulk upload state
  const [showBulk, setShowBulk] = useState(false)
  const [bulkMode, setBulkMode] = useState<MeetingImportMode>('active')
  const [batch, setBatch] = useState<BatchEntry[]>([])
  const [batchRunning, setBatchRunning] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetSingleForm = () => {
    setShowForm(false)
    setNewTitle('')
    setNewDate(todayString())
    setNewTranscript('')
    setNewMode('active')
    setSingleError(null)
  }

  const handleCreate = async () => {
    const transcriptTrimmed = newTranscript.trim()
    const titleTrimmed = newTitle.trim()

    // If no transcript and no title, there's nothing to create.
    if (!transcriptTrimmed && !titleTrimmed) {
      setSingleError('Add a transcript, paste a HiNotes URL, or enter a title.')
      return
    }

    setSingleError(null)
    setSingleSubmitting(true)
    try {
      // HiNotes URL path: resolve via the hinotes-fetch edge function and
      // use the returned title/start_time/markdown as the source content.
      // This bypasses the manual paste step entirely.
      let resolvedTitle = titleTrimmed
      let resolvedTranscript = transcriptTrimmed
      let resolvedStartTime: string | undefined = newDate
        ? new Date(`${newDate}T12:00:00`).toISOString()
        : undefined
      let resolvedAttendees: string[] | undefined = undefined

      if (transcriptTrimmed && isHiNotesUrl(transcriptTrimmed)) {
        const { data, error } = await supabase.functions.invoke('hinotes-fetch', {
          body: { url: transcriptTrimmed },
        })
        if (error) {
          // Try to surface the underlying detail from the function response.
          const ctx = (error as { context?: Response }).context
          if (ctx && typeof ctx.json === 'function') {
            try {
              const body = await ctx.json()
              throw new Error(body?.detail ?? body?.error ?? 'HiNotes fetch failed')
            } catch (parseErr) {
              if (parseErr instanceof Error) throw parseErr
            }
          }
          throw error
        }
        const fetched = data as {
          title?: string
          content?: string
          content_source?: 'verbatim_transcript' | 'markdown_outline'
          start_time?: string | null
          speaker_mapping?: Record<string, string>
          speakers_named?: number
          attendees?: string[]
        }
        if (!fetched.content) {
          throw new Error('HiNotes returned no content for that share URL.')
        }
        // Diagnostic — surface speaker mapping + attendees in console.
        console.log('[hinotes-fetch] speakers_named =', fetched.speakers_named ?? 0)
        console.log('[hinotes-fetch] speaker_mapping =', fetched.speaker_mapping ?? {})
        console.log('[hinotes-fetch] attendees =', fetched.attendees ?? [])
        if (fetched.content) {
          console.log('[hinotes-fetch] first 500 chars of content =', fetched.content.slice(0, 500))
        }
        resolvedTranscript = fetched.content
        // Only override the title with the HiNotes one if the user didn't
        // type their own. AI auto-title still runs on the parser side.
        if (!resolvedTitle && fetched.title) {
          resolvedTitle = fetched.title
        }
        if (fetched.start_time) {
          resolvedStartTime = fetched.start_time
        }
        if (fetched.attendees && fetched.attendees.length > 0) {
          resolvedAttendees = fetched.attendees
        }
      }

      // Title fallback: explicit/resolved title > "Untitled discussion".
      // The placeholder triggers AI auto-titling on the edge function side
      // when the parse runs.
      const title = resolvedTitle || 'Untitled discussion'

      const meeting = await createMeeting.mutateAsync({
        title,
        start_time: resolvedStartTime,
        import_mode: newMode,
        attendees: resolvedAttendees,
      })

      // If we have content to parse, upload + parse in the same action so
      // the user never has to click "Create" then "Analyze" separately.
      if (resolvedTranscript) {
        await uploadTranscript.mutateAsync({
          meetingId: meeting.id,
          transcript: resolvedTranscript,
        })
      }

      resetSingleForm()
      navigate(`/meetings/${meeting.id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSingleError(msg)
    } finally {
      setSingleSubmitting(false)
    }
  }

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    deleteMeeting.mutate(id)
  }

  // ============================================================
  // Bulk upload
  // ============================================================

  const queueFiles = (files: File[]) => {
    if (files.length === 0) return
    const entries: BatchEntry[] = files.map((f) => ({
      id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 8)}`,
      filename: f.name,
      size: f.size,
      status: 'queued',
    }))
    setBatch((prev) => [...prev, ...entries])
    // Stash actual File objects on a side ref via a closure — easiest is
    // to keep a parallel map; here we just process inline below.
    return entries.map((e, i) => ({ entry: e, file: files[i] }))
  }

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    void runBatch(files)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : []
    void runBatch(files)
  }

  const runBatch = async (files: File[]) => {
    if (files.length === 0) return
    const queued = queueFiles(files)
    if (!queued || queued.length === 0) return
    setBatchRunning(true)

    for (const { entry, file } of queued) {
      try {
        // Step 1: read file content as text
        setBatch((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, status: 'uploading' } : e))
        )
        const text = await file.text()
        if (!text.trim()) {
          throw new Error('File is empty')
        }

        // Step 2: create meeting with placeholder title and best-effort date
        const startTime = extractDateFromFilename(file.name)
        const placeholder = placeholderTitleFromFilename(file.name)
        const meeting = await createMeeting.mutateAsync({
          title: placeholder,
          start_time: startTime ?? undefined,
          import_mode: bulkMode,
        })

        // Step 3: upload transcript + parse (edge function will auto-title)
        setBatch((prev) =>
          prev.map((e) =>
            e.id === entry.id ? { ...e, status: 'parsing', meetingId: meeting.id } : e
          )
        )
        await uploadTranscript.mutateAsync({
          meetingId: meeting.id,
          transcript: text,
        })

        setBatch((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, status: 'done' } : e))
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setBatch((prev) =>
          prev.map((e) =>
            e.id === entry.id ? { ...e, status: 'error', error: message } : e
          )
        )
      }
    }
    setBatchRunning(false)
  }

  const closeBulk = () => {
    if (batchRunning) return
    setShowBulk(false)
    setBatch([])
  }

  const grouped = useMemo(() => {
    if (!meetings) return new Map<string, Meeting[]>()
    return groupByDate(meetings)
  }, [meetings])

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Discussions</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBulk(true)}
            className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800"
          >
            <Upload size={16} />
            Upload files
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
          >
            <Plus size={16} />
            Add Discussion
          </button>
        </div>
      </div>

      {/* Bulk upload panel */}
      {showBulk && (
        <div className="mb-6 rounded-xl border border-gray-700 bg-gray-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Upload discussion files</h2>
            <button
              onClick={closeBulk}
              disabled={batchRunning}
              className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-300 disabled:opacity-50"
              title={batchRunning ? 'Wait for batch to finish' : 'Close'}
            >
              <X size={16} />
            </button>
          </div>

          {/* Mode picker */}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-800 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setBulkMode('active')}
                disabled={batchRunning}
                className={`flex items-center gap-1 rounded px-2 py-1 transition-colors disabled:opacity-50 ${
                  bulkMode === 'active'
                    ? 'bg-green-700/40 text-green-200'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Radio size={11} />
                Active
              </button>
              <button
                type="button"
                onClick={() => setBulkMode('archive')}
                disabled={batchRunning}
                className={`flex items-center gap-1 rounded px-2 py-1 transition-colors disabled:opacity-50 ${
                  bulkMode === 'archive'
                    ? 'bg-gray-600/60 text-gray-200'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Archive size={11} />
                Archive
              </button>
            </div>
            <span className="text-[11px] text-gray-500">
              {bulkMode === 'active'
                ? 'Action items become live proposals'
                : 'Summarized only, no proposals created — for old recordings'}
            </span>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragOver
                ? 'border-purple-500 bg-purple-950/30'
                : 'border-gray-700 hover:border-gray-600 hover:bg-gray-800/30'
            }`}
          >
            <Upload size={20} className="mb-2 text-gray-500" />
            <p className="text-sm text-gray-300">
              Drop transcript files here or click to choose
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Multiple files OK · text formats (.txt, .vtt, .srt, .md, .hda, etc.)
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFilePick}
              className="hidden"
            />
          </div>

          {/* Per-file progress */}
          {batch.length > 0 && (
            <div className="mt-4 space-y-1">
              {batch.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/40 px-3 py-2 text-xs"
                >
                  {entry.status === 'queued' && (
                    <div className="h-3 w-3 flex-shrink-0 rounded-full border border-gray-600" />
                  )}
                  {(entry.status === 'uploading' || entry.status === 'parsing') && (
                    <Loader2 size={12} className="flex-shrink-0 animate-spin text-purple-400" />
                  )}
                  {entry.status === 'done' && (
                    <Check size={12} className="flex-shrink-0 text-green-400" />
                  )}
                  {entry.status === 'error' && (
                    <AlertCircle size={12} className="flex-shrink-0 text-red-400" />
                  )}
                  <span className="flex-1 truncate text-gray-300">{entry.filename}</span>
                  <span className="text-gray-600">
                    {entry.status === 'queued' && 'Queued'}
                    {entry.status === 'uploading' && 'Reading...'}
                    {entry.status === 'parsing' && 'Parsing...'}
                    {entry.status === 'done' && (
                      <button
                        onClick={() => entry.meetingId && navigate(`/meetings/${entry.meetingId}`)}
                        className="text-purple-400 hover:text-purple-300"
                      >
                        Open
                      </button>
                    )}
                    {entry.status === 'error' && (
                      <span className="text-red-400" title={entry.error}>
                        Failed
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div className="mb-6 space-y-3 rounded-xl border border-gray-700 bg-gray-900 p-4">
          {/* Transcript first — this is the main thing the user wants to do */}
          <textarea
            value={newTranscript}
            onChange={(e) => setNewTranscript(e.target.value)}
            placeholder="Paste a transcript, meeting notes, or a HiNotes share URL (https://hinotes.hidock.com/s/...). Title and date auto-fill from the content."
            rows={8}
            disabled={singleSubmitting}
            className="block w-full resize-y rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none disabled:opacity-50"
            autoFocus
          />
          {newTranscript.trim() && isHiNotesUrl(newTranscript) && (
            <div className="flex items-center gap-2 text-xs text-purple-300">
              <Link2 size={12} />
              <span>HiNotes link detected — will fetch content directly</span>
            </div>
          )}

          {/* Optional metadata: title + date. AI fills these in if blank. */}
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Title (optional — AI will suggest one)"
              disabled={singleSubmitting}
              className="flex-1 min-w-[200px] rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none disabled:opacity-50"
            />
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              disabled={singleSubmitting}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          {/* Mode + actions */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-800 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setNewMode('active')}
                disabled={singleSubmitting}
                className={`flex items-center gap-1 rounded px-2 py-1 transition-colors disabled:opacity-50 ${
                  newMode === 'active'
                    ? 'bg-green-700/40 text-green-200'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Radio size={11} />
                Active
              </button>
              <button
                type="button"
                onClick={() => setNewMode('archive')}
                disabled={singleSubmitting}
                className={`flex items-center gap-1 rounded px-2 py-1 transition-colors disabled:opacity-50 ${
                  newMode === 'archive'
                    ? 'bg-gray-600/60 text-gray-200'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Archive size={11} />
                Archive
              </button>
            </div>
            <span className="text-[11px] text-gray-500">
              {newMode === 'active'
                ? 'Action items become live proposals'
                : 'Summarized only, no proposals created'}
            </span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={handleCreate}
                disabled={singleSubmitting || (!newTranscript.trim() && !newTitle.trim())}
                className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
              >
                {singleSubmitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    {isHiNotesUrl(newTranscript)
                      ? 'Fetching...'
                      : newTranscript.trim()
                        ? 'Analyzing...'
                        : 'Creating...'}
                  </>
                ) : (
                  isHiNotesUrl(newTranscript)
                    ? 'Fetch & analyze'
                    : newTranscript.trim()
                      ? 'Analyze'
                      : 'Create empty'
                )}
              </button>
              <button
                onClick={resetSingleForm}
                disabled={singleSubmitting}
                className="rounded-lg px-3 py-2 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>

          {singleError && (
            <div className="rounded border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {singleError}
            </div>
          )}
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
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-white">
                          {meeting.title}
                        </span>
                        {meeting.import_mode === 'archive' && (
                          <span
                            className="flex flex-shrink-0 items-center gap-1 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gray-400"
                            title="Archived recording — no live proposals"
                          >
                            <Archive size={9} />
                            Archive
                          </span>
                        )}
                      </div>
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
