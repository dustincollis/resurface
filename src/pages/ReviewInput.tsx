import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Upload, Image as ImageIcon, Mail, FileText, X, Loader2, Sparkles, Check,
} from 'lucide-react'
import { useCreateReviewInput } from '../hooks/useReviewInputs'
import type { ReviewInputType } from '../lib/types'

type TabKey = 'file' | 'paste'

interface StagedFile {
  file: File
  input_type: 'email' | 'screenshot'
  preview?: string // object URL for image previews
}

const MAX_FILE_MB = 10

export default function ReviewInput() {
  const navigate = useNavigate()
  const createInput = useCreateReviewInput()

  const [tab, setTab] = useState<TabKey>('file')
  const [staged, setStaged] = useState<StagedFile | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [description, setDescription] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Release any object URL when the component unmounts or staged changes.
  useEffect(() => {
    return () => {
      if (staged?.preview) URL.revokeObjectURL(staged.preview)
    }
  }, [staged])

  const classifyFile = (file: File): StagedFile | null => {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`File too large (max ${MAX_FILE_MB}MB).`)
      return null
    }
    if (file.type.startsWith('image/')) {
      return { file, input_type: 'screenshot', preview: URL.createObjectURL(file) }
    }
    // .eml files have inconsistent MIME types across browsers; sniff by extension.
    const isEml = /\.eml$/i.test(file.name) || file.type === 'message/rfc822'
    if (isEml) {
      return { file, input_type: 'email' }
    }
    setError('Unsupported file type. Use an .eml email or an image.')
    return null
  }

  const onFilesPicked = (files: FileList | File[]) => {
    setError(null)
    const list = Array.from(files)
    if (list.length === 0) return
    const classified = classifyFile(list[0])
    if (classified) setStaged(classified)
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }
  const onDragLeave = () => setDragging(false)
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length > 0) {
      onFilesPicked(e.dataTransfer.files)
    }
  }

  // Paste handler: when user Cmd+Vs an image anywhere on this page, stage it.
  // Pasted text gets routed to the text input instead.
  const onPaste = useCallback((e: ClipboardEvent) => {
    if (!e.clipboardData) return
    const items = Array.from(e.clipboardData.items)
    const imageItem = items.find((it) => it.type.startsWith('image/'))
    if (imageItem) {
      const file = imageItem.getAsFile()
      if (file) {
        e.preventDefault()
        // Pasted images have no filename; synthesize one for storage.
        const namedFile = new File([file], `pasted-${Date.now()}.png`, { type: file.type })
        const classified = classifyFile(namedFile)
        if (classified) {
          setStaged(classified)
          setTab('file')
        }
      }
    }
  }, [])

  useEffect(() => {
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [onPaste])

  const clearStaged = () => {
    if (staged?.preview) URL.revokeObjectURL(staged.preview)
    setStaged(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const canSubmit = (): boolean => {
    if (createInput.isPending) return false
    if (tab === 'file' && staged) return true
    if (tab === 'paste' && pasteText.trim().length > 0) return true
    return false
  }

  const handleSubmit = async () => {
    setError(null)
    try {
      let input_type: ReviewInputType
      let payload: Parameters<typeof createInput.mutateAsync>[0]

      if (tab === 'file' && staged) {
        input_type = staged.input_type
        payload = {
          input_type,
          file: staged.file,
          user_description: description,
        }
      } else if (tab === 'paste' && pasteText.trim()) {
        input_type = 'pasted_text'
        payload = {
          input_type,
          raw_text: pasteText,
          user_description: description,
        }
      } else {
        return
      }

      const { input, result } = await createInput.mutateAsync(payload)
      const total = (result.proposals_created ?? 0) + (result.commitments_created ?? 0)
      if (total > 0) {
        navigate(`/proposals?source_type=input&source_id=${input.id}`)
      } else {
        // No proposals extracted — let the user know and stay on the page.
        setError(
          'AI didn\'t find any action items in that input. Try adding a description with more context, or capture a different snippet.'
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    }
  }

  return (
    <div
      className="mx-auto max-w-3xl"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Review Input</h1>
        <p className="mt-1 text-sm text-gray-400">
          Drop an email (<code className="rounded bg-gray-800 px-1 py-0.5 text-[11px]">.eml</code>), paste a screenshot, upload an image, or paste text. AI extracts action items and commitments as proposals, same pipeline as meetings.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="mb-4 flex gap-1 rounded-lg border border-gray-800 bg-gray-900 p-1">
        <button
          onClick={() => setTab('file')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === 'file' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Upload size={12} className="mr-1.5 inline" />
          File / Image
        </button>
        <button
          onClick={() => setTab('paste')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === 'paste' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <FileText size={12} className="mr-1.5 inline" />
          Paste text
        </button>
      </div>

      {tab === 'file' && (
        <div>
          {!staged ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 transition-colors ${
                dragging
                  ? 'border-purple-500 bg-purple-950/20'
                  : 'border-gray-800 hover:border-gray-700 hover:bg-gray-900/50'
              }`}
            >
              <Upload size={28} className="text-gray-600" />
              <div className="text-sm text-gray-300">
                Drop a file here, click to pick one, or <span className="text-purple-300">Cmd+V</span> to paste a screenshot
              </div>
              <div className="text-xs text-gray-600">
                .eml emails · images (PNG/JPG) · max {MAX_FILE_MB}MB
              </div>
            </button>
          ) : (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              <div className="mb-3 flex items-center gap-3">
                {staged.input_type === 'email' ? (
                  <Mail size={18} className="flex-shrink-0 text-blue-400" />
                ) : (
                  <ImageIcon size={18} className="flex-shrink-0 text-purple-400" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white">{staged.file.name}</div>
                  <div className="text-xs text-gray-500">
                    {staged.input_type === 'email' ? 'Email' : 'Screenshot'} · {(staged.file.size / 1024).toFixed(0)} KB
                  </div>
                </div>
                <button
                  onClick={clearStaged}
                  disabled={createInput.isPending}
                  className="rounded p-1 text-gray-600 hover:bg-gray-800 hover:text-gray-300 disabled:opacity-50"
                  title="Remove"
                >
                  <X size={14} />
                </button>
              </div>
              {staged.preview && (
                <img
                  src={staged.preview}
                  alt="preview"
                  className="max-h-80 w-full rounded-lg border border-gray-800 object-contain"
                />
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".eml,image/*,message/rfc822"
            onChange={(e) => e.target.files && onFilesPicked(e.target.files)}
            className="hidden"
          />
        </div>
      )}

      {tab === 'paste' && (
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="Paste the email body, Slack thread, Teams chat, or any text with actionable content..."
          rows={10}
          className="w-full rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm text-white placeholder:text-gray-600 focus:border-purple-600 focus:outline-none"
        />
      )}

      {/* Description block — always visible, optional */}
      <div className="mt-4">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-gray-500">
          Description / context (optional)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder='e.g. "From Brian about the Mars deal, need to follow up by EOW"'
          rows={2}
          className="w-full rounded-lg border border-gray-800 bg-gray-900 p-3 text-sm text-white placeholder:text-gray-600 focus:border-purple-600 focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-gray-600">
          Anything the AI won't know from the content alone — who sent it, why it matters, what deal it's about.
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit()}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createInput.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Analyzing…
            </>
          ) : (
            <>
              <Sparkles size={14} />
              Extract proposals
            </>
          )}
        </button>
        {createInput.isSuccess && !error && (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <Check size={12} /> Done — redirecting to proposals…
          </span>
        )}
      </div>
    </div>
  )
}
