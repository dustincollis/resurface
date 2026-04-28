import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Upload, Image as ImageIcon, Mail, X, Loader2, Sparkles, Check, Plus,
  ArrowLeft, FileUp, ClipboardPaste, SquarePen,
} from 'lucide-react'
import { useCreateReviewInput, useBatchUploadInputs } from '../hooks/useReviewInputs'
import { useCreateItem } from '../hooks/useItems'
import { useStreams } from '../hooks/useStreams'
import type { ReviewInputType } from '../lib/types'

type Mode = 'pick' | 'file' | 'paste' | 'task'

interface StagedFile {
  file: File
  input_type: 'email' | 'screenshot'
  preview?: string
}

const MAX_FILE_MB = 10

function todayString(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function Add() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const createInput = useCreateReviewInput()
  const batchUpload = useBatchUploadInputs()
  const createItem = useCreateItem()
  const { data: streams } = useStreams()

  // Initial mode honors ?mode=file|paste|task so AddMenu options deep-link here
  // and skip the picker; bare /add still lands on the picker.
  const initialMode = ((): Mode => {
    const m = searchParams.get('mode')
    if (m === 'file' || m === 'paste' || m === 'task') return m
    return 'pick'
  })()
  const [mode, setMode] = useState<Mode>(initialMode)

  // File state. `staged` is a list: single-file uploads stage as a
  // one-item list, multi-file drops extend it. Submit handler branches
  // on length (single-file keeps the existing single-input path; multi
  // uses the batch flow with triage).
  const [staged, setStaged] = useState<StagedFile[]>([])
  const [dragging, setDragging] = useState(false)
  const [fileContext, setFileContext] = useState('')
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  const [batchResult, setBatchResult] = useState<{ actionable: number; skipped: number; failed: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Paste state
  const [pasteText, setPasteText] = useState('')
  const [pasteContext, setPasteContext] = useState('')

  // Manual task state
  const [title, setTitle] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [streamId, setStreamId] = useState('')
  const [dueDate, setDueDate] = useState(todayString())
  const [stakes, setStakes] = useState(3)
  const [resistance, setResistance] = useState(3)
  const [itemDescription, setItemDescription] = useState('')

  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      for (const s of staged) {
        if (s.preview) URL.revokeObjectURL(s.preview)
      }
    }
  }, [staged])

  // Clear error whenever mode changes
  useEffect(() => { setError(null) }, [mode])

  const classifyFile = (file: File): StagedFile | null => {
    if (file.size > MAX_FILE_MB * 1024 * 1024) return null
    if (file.type.startsWith('image/')) {
      return { file, input_type: 'screenshot', preview: URL.createObjectURL(file) }
    }
    const isEml = /\.eml$/i.test(file.name) || file.type === 'message/rfc822'
    if (isEml) return { file, input_type: 'email' }
    return null
  }

  const onFilesPicked = (files: FileList | File[]) => {
    setError(null)
    setBatchResult(null)
    const list = Array.from(files)
    if (list.length === 0) return
    const newlyStaged: StagedFile[] = []
    const errors: string[] = []
    for (const f of list) {
      const classified = classifyFile(f)
      if (classified) newlyStaged.push(classified)
      else errors.push(f.name)
    }
    if (newlyStaged.length > 0) {
      setStaged((prev) => [...prev, ...newlyStaged])
    }
    if (errors.length > 0) {
      setError(`Skipped ${errors.length} unsupported file${errors.length === 1 ? '' : 's'}.`)
    }
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }
  const onDragLeave = () => setDragging(false)
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length > 0) onFilesPicked(e.dataTransfer.files)
  }

  // Auto-stage pasted images (works on file mode; on paste mode text goes to textarea)
  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      if (mode !== 'file') return
      if (!e.clipboardData) return
      const imageItem = Array.from(e.clipboardData.items).find((it) => it.type.startsWith('image/'))
      if (imageItem) {
        const file = imageItem.getAsFile()
        if (file) {
          e.preventDefault()
          const named = new File([file], `pasted-${Date.now()}.png`, { type: file.type })
          const classified = classifyFile(named)
          if (classified) setStaged((prev) => [...prev, classified])
          else setError(`File too large or unsupported type.`)
        }
      }
    },
    [mode]
  )

  useEffect(() => {
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [onPaste])

  const clearStaged = () => {
    for (const s of staged) if (s.preview) URL.revokeObjectURL(s.preview)
    setStaged([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeStagedAt = (idx: number) => {
    setStaged((prev) => {
      const victim = prev[idx]
      if (victim?.preview) URL.revokeObjectURL(victim.preview)
      return prev.filter((_, i) => i !== idx)
    })
  }

  const handleFileSubmit = async () => {
    if (staged.length === 0) return
    setError(null)
    setBatchResult(null)

    // Single-file path preserves the original "wait for proposals, jump to
    // filtered view" behavior. Multi-file goes through the batch/catalog
    // flow which runs triage first and synthesis in the background.
    if (staged.length === 1) {
      try {
        const { input, result } = await createInput.mutateAsync({
          input_type: staged[0].input_type,
          file: staged[0].file,
          user_description: fileContext,
        })
        const total = (result.proposals_created ?? 0) + (result.commitments_created ?? 0)
        if (total > 0) navigate(`/proposals?source_type=input&source_id=${input.id}`)
        else setError("AI didn't find any action items. Try adding more context.")
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
      return
    }

    setBatchProgress({ done: 0, total: staged.length })
    try {
      const result = await batchUpload.mutateAsync({
        files: staged.map((s) => s.file),
        user_description: fileContext,
        onProgress: (done, total) => setBatchProgress({ done, total }),
      })
      setBatchResult({
        actionable: result.catalog?.actionable ?? 0,
        skipped: result.catalog?.skipped ?? 0,
        failed: result.failed_uploads.length,
      })
      // Clear staged but stay on the page so the user can see the result
      clearStaged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBatchProgress(null)
    }
  }

  const handlePasteSubmit = async () => {
    if (!pasteText.trim()) return
    setError(null)
    try {
      const payload: Parameters<typeof createInput.mutateAsync>[0] = {
        input_type: 'pasted_text' as ReviewInputType,
        raw_text: pasteText,
        user_description: pasteContext,
      }
      const { input, result } = await createInput.mutateAsync(payload)
      const total = (result.proposals_created ?? 0) + (result.commitments_created ?? 0)
      if (total > 0) navigate(`/proposals?source_type=input&source_id=${input.id}`)
      else setError('AI didn\'t find any action items. Try adding more context.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleTaskSubmit = async () => {
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    setError(null)
    try {
      const newItem = await createItem.mutateAsync({
        title: title.trim(),
        description: itemDescription || undefined,
        next_action: nextAction || undefined,
        stream_id: streamId || null,
        due_date: dueDate || null,
        stakes,
        resistance,
      })
      navigate(`/items/${newItem.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div
      className="mx-auto max-w-2xl"
      onDragOver={mode === 'file' ? onDragOver : undefined}
      onDragLeave={mode === 'file' ? onDragLeave : undefined}
      onDrop={mode === 'file' ? onDrop : undefined}
    >
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        {mode !== 'pick' && (
          <button
            onClick={() => setMode('pick')}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
            title="Back"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <div>
          <h1 className="text-2xl font-semibold text-white">
            {mode === 'pick' && 'Add'}
            {mode === 'file' && 'Add from file'}
            {mode === 'paste' && 'Add from pasted text'}
            {mode === 'task' && 'Add a task'}
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {mode === 'pick' && 'How do you want to capture this?'}
            {mode === 'file' && 'Drop an email or screenshot — AI extracts all action items as proposals.'}
            {mode === 'paste' && 'Paste any text — AI extracts all action items as proposals.'}
            {mode === 'task' && 'Create a single item directly, no review step.'}
          </p>
        </div>
      </div>

      {/* Mode picker */}
      {mode === 'pick' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <ModeCard
            icon={FileUp}
            title="File"
            blurb=".eml email or image — AI finds every action item"
            accent="purple"
            onClick={() => setMode('file')}
          />
          <ModeCard
            icon={ClipboardPaste}
            title="Paste"
            blurb="Slack thread, email body, any text — AI extracts the work"
            accent="blue"
            onClick={() => setMode('paste')}
          />
          <ModeCard
            icon={SquarePen}
            title="Task"
            blurb="Write a single task yourself — added directly"
            accent="green"
            onClick={() => setMode('task')}
          />
        </div>
      )}

      {/* File lane */}
      {mode === 'file' && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5">
          {staged.length === 0 ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-14 transition-colors ${
                dragging
                  ? 'border-purple-500 bg-purple-950/20'
                  : 'border-gray-800 hover:border-gray-700 hover:bg-gray-900/50'
              }`}
            >
              <Upload size={28} className="text-gray-600" />
              <div className="text-sm text-gray-300">
                Drop files here, click to pick, or{' '}
                <span className="text-purple-300">Cmd+V</span> to paste a screenshot
              </div>
              <div className="text-xs text-gray-600">
                .eml emails · images · max {MAX_FILE_MB}MB each · multi-select supported
              </div>
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between pb-1">
                <span className="text-xs uppercase tracking-wider text-gray-500">
                  {staged.length} file{staged.length === 1 ? '' : 's'} staged
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={createInput.isPending || batchUpload.isPending}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 disabled:opacity-50"
                  >
                    <Plus size={12} />
                    Add more
                  </button>
                  <button
                    onClick={clearStaged}
                    disabled={createInput.isPending || batchUpload.isPending}
                    className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-800 hover:text-gray-300 disabled:opacity-50"
                  >
                    Clear all
                  </button>
                </div>
              </div>
              <div className="max-h-80 space-y-1.5 overflow-y-auto">
                {staged.map((s, idx) => (
                  <div
                    key={`${s.file.name}-${idx}`}
                    className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2"
                  >
                    {s.input_type === 'email' ? (
                      <Mail size={14} className="flex-shrink-0 text-blue-400" />
                    ) : (
                      <ImageIcon size={14} className="flex-shrink-0 text-purple-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-gray-200">{s.file.name}</div>
                      <div className="text-[10px] text-gray-600">
                        {s.input_type === 'email' ? 'Email' : 'Screenshot'} ·{' '}
                        {(s.file.size / 1024).toFixed(0)} KB
                      </div>
                    </div>
                    <button
                      onClick={() => removeStagedAt(idx)}
                      disabled={createInput.isPending || batchUpload.isPending}
                      className="rounded p-1 text-gray-600 hover:bg-gray-800 hover:text-gray-300 disabled:opacity-50"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".eml,image/*,message/rfc822"
            multiple
            onChange={(e) => e.target.files && onFilesPicked(e.target.files)}
            className="hidden"
          />

          <ContextBlock
            value={fileContext}
            onChange={setFileContext}
            placeholder='e.g. "Morning batch, all from the Adobe Summit thread"'
          />

          {error && <ErrorChip>{error}</ErrorChip>}

          {batchProgress && (
            <div className="mt-3 rounded-lg border border-purple-900/40 bg-purple-950/20 px-3 py-2 text-xs text-purple-200">
              <Loader2 size={12} className="mr-1.5 inline animate-spin" />
              Uploading {batchProgress.done} of {batchProgress.total}…
            </div>
          )}

          {batchResult && (
            <div className="mt-3 rounded-lg border border-purple-900/40 bg-purple-950/20 px-3 py-2 text-xs text-purple-200">
              <Sparkles size={12} className="mr-1.5 inline" />
              Cataloged batch — <strong>{batchResult.actionable}</strong> worth synthesizing,{' '}
              <strong>{batchResult.skipped}</strong> skipped by triage
              {batchResult.failed > 0 && <>, {batchResult.failed} failed to upload</>}.
              Proposals will appear on{' '}
              <button onClick={() => navigate('/proposals')} className="underline hover:text-white">
                /proposals
              </button>{' '}
              as they finish.
            </div>
          )}

          <div className="mt-4">
            <PrimaryButton
              disabled={staged.length === 0 || createInput.isPending || batchUpload.isPending}
              onClick={handleFileSubmit}
              loading={createInput.isPending || batchUpload.isPending}
              loadingLabel={staged.length > 1 ? 'Cataloging…' : 'Analyzing…'}
            >
              <Sparkles size={14} />
              {staged.length > 1 ? `Extract proposals from ${staged.length} files` : 'Extract proposals'}
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Paste lane */}
      {mode === 'paste' && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste the email body, Slack thread, Teams chat, or any text with actionable content..."
            rows={10}
            autoFocus
            className="w-full rounded-xl border border-gray-800 bg-gray-950 p-4 text-sm text-white placeholder:text-gray-600 focus:border-purple-600 focus:outline-none"
          />

          <ContextBlock
            value={pasteContext}
            onChange={setPasteContext}
            placeholder='e.g. "Thread from Slack, Holly agreed to the Mar 30 date"'
          />

          {error && <ErrorChip>{error}</ErrorChip>}

          <div className="mt-4">
            <PrimaryButton
              disabled={!pasteText.trim() || createInput.isPending}
              onClick={handlePasteSubmit}
              loading={createInput.isPending}
              loadingLabel="Analyzing…"
            >
              <Sparkles size={14} />
              Extract proposals
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Task lane */}
      {mode === 'task' && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5">
          <div className="space-y-4">
            <Field label="Title *">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && title.trim()) {
                    e.preventDefault()
                    handleTaskSubmit()
                  }
                }}
                placeholder="What needs doing?"
                autoFocus
                className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-purple-600 focus:outline-none"
              />
            </Field>

            <Field label="Next action">
              <input
                type="text"
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                placeholder="The very next physical step"
                className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-purple-600 focus:outline-none"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Stream">
                <select
                  value={streamId}
                  onChange={(e) => setStreamId(e.target.value)}
                  className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white focus:border-purple-600 focus:outline-none"
                >
                  <option value="">Uncategorized</option>
                  {streams?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Due date">
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  onClick={(e) => e.currentTarget.showPicker?.()}
                  style={{ colorScheme: 'dark' }}
                  className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white focus:border-purple-600 focus:outline-none"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <ScaleSelector label="Stakes" value={stakes} onChange={setStakes} color="red" />
              <ScaleSelector label="Resistance" value={resistance} onChange={setResistance} color="yellow" />
            </div>

            <Field label="Description">
              <textarea
                value={itemDescription}
                onChange={(e) => setItemDescription(e.target.value)}
                placeholder="Optional notes, context, links…"
                rows={3}
                className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-purple-600 focus:outline-none"
              />
            </Field>
          </div>

          {error && <ErrorChip>{error}</ErrorChip>}

          <div className="mt-5 flex items-center gap-3">
            <PrimaryButton
              disabled={createItem.isPending || !title.trim()}
              onClick={handleTaskSubmit}
              loading={createItem.isPending}
              loadingLabel="Creating…"
              tone="green"
            >
              <Plus size={14} />
              Add task
            </PrimaryButton>
            {createItem.isSuccess && !error && (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <Check size={12} /> Done
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================

function ModeCard({
  icon: Icon,
  title,
  blurb,
  accent,
  onClick,
}: {
  icon: typeof FileUp
  title: string
  blurb: string
  accent: 'purple' | 'blue' | 'green'
  onClick: () => void
}) {
  const accentClass: Record<typeof accent, string> = {
    purple: 'group-hover:border-purple-700 group-hover:bg-purple-950/20',
    blue: 'group-hover:border-blue-700 group-hover:bg-blue-950/20',
    green: 'group-hover:border-green-700 group-hover:bg-green-950/20',
  }
  const iconColor: Record<typeof accent, string> = {
    purple: 'text-purple-400',
    blue: 'text-blue-400',
    green: 'text-green-400',
  }
  return (
    <button
      onClick={onClick}
      className={`group rounded-2xl border border-gray-800 bg-gray-900/40 p-5 text-left transition-all hover:-translate-y-0.5 ${accentClass[accent]}`}
    >
      <div className={`mb-3 inline-flex rounded-lg bg-gray-950 p-2.5 ${iconColor[accent]}`}>
        <Icon size={20} />
      </div>
      <div className="text-sm font-semibold text-white">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-gray-500">{blurb}</p>
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">
        {label}
      </label>
      {children}
    </div>
  )
}

function ContextBlock({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="mt-4">
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">
        Context for AI (optional)
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs text-white placeholder:text-gray-600 focus:border-purple-600 focus:outline-none"
      />
    </div>
  )
}

function ErrorChip({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
      {children}
    </div>
  )
}

function PrimaryButton({
  onClick,
  disabled,
  loading,
  loadingLabel,
  tone = 'purple',
  children,
}: {
  onClick: () => void
  disabled: boolean
  loading: boolean
  loadingLabel: string
  tone?: 'purple' | 'green'
  children: React.ReactNode
}) {
  const toneClass =
    tone === 'green'
      ? 'bg-green-600 hover:bg-green-500'
      : 'bg-purple-600 hover:bg-purple-500'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    >
      {loading ? (
        <>
          <Loader2 size={14} className="animate-spin" />
          {loadingLabel}
        </>
      ) : (
        children
      )}
    </button>
  )
}

function ScaleSelector({
  label,
  value,
  onChange,
  color,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  color: 'red' | 'yellow'
}) {
  const activeClass =
    color === 'red'
      ? 'border-red-700 bg-red-900/40 text-red-200'
      : 'border-yellow-700 bg-yellow-900/40 text-yellow-200'
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">
        {label}
      </label>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
              value === n
                ? activeClass
                : 'border-gray-800 text-gray-500 hover:border-gray-700 hover:text-gray-300'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}
