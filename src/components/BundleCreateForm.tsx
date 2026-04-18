import { useState } from 'react'
import { Loader2, Plus, Minus } from 'lucide-react'
import { useCreateBundle, useIngestBundle } from '../hooks/useBundles'

interface DocumentEntry {
  title: string
  content_md: string
}

interface Props {
  onCreated: (bundleId: string) => void
  onCancel: () => void
}

export default function BundleCreateForm({ onCreated, onCancel }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [documents, setDocuments] = useState<DocumentEntry[]>([
    { title: '', content_md: '' },
    { title: '', content_md: '' },
  ])
  const [error, setError] = useState<string | null>(null)

  const createBundle = useCreateBundle()
  const ingestBundle = useIngestBundle()

  const isPending = createBundle.isPending || ingestBundle.isPending

  const addDocument = () => {
    setDocuments((prev) => [...prev, { title: '', content_md: '' }])
  }

  const removeDocument = (index: number) => {
    setDocuments((prev) => prev.filter((_, i) => i !== index))
  }

  const updateDocument = (index: number, field: keyof DocumentEntry, value: string) => {
    setDocuments((prev) => prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)))
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    const validDocs = documents.filter((d) => d.title.trim() && d.content_md.trim())
    if (validDocs.length === 0) {
      setError('Paste at least one source document')
      return
    }
    setError(null)

    try {
      const bundle = await createBundle.mutateAsync({
        name: name.trim(),
        kind: 'event',
        description: description.trim() || null,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
      })

      await ingestBundle.mutateAsync({
        bundleId: bundle.id,
        documents: validDocs,
      })

      onCreated(bundle.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-white">New Event Bundle</h1>
        <p className="mt-1 text-sm text-gray-500">
          Paste your briefing documents below. They'll be chunked, embedded, and made queryable.
        </p>
      </div>

      {/* Bundle metadata */}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">Event name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Adobe Summit 2026"
            className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">Description (optional)</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Las Vegas, April 19-22"
            className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Starts</label>
            <input
              type="date"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white focus:border-purple-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Ends</label>
            <input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white focus:border-purple-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Documents */}
      <div className="space-y-4">
        <h2 className="text-sm font-medium text-gray-300">Source Documents</h2>
        {documents.map((doc, i) => (
          <div key={i} className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">Document {i + 1}</span>
              {documents.length > 1 && (
                <button
                  onClick={() => removeDocument(i)}
                  className="rounded p-1 text-gray-600 hover:text-red-400"
                >
                  <Minus size={12} />
                </button>
              )}
            </div>
            <input
              type="text"
              value={doc.title}
              onChange={(e) => updateDocument(i, 'title', e.target.value)}
              placeholder="Document title (e.g. Summit Briefing 2026)"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
            <textarea
              value={doc.content_md}
              onChange={(e) => updateDocument(i, 'content_md', e.target.value)}
              placeholder="Paste the markdown content here..."
              rows={10}
              className="w-full resize-y rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-xs text-gray-200 placeholder-gray-600 focus:border-purple-500 focus:outline-none"
            />
          </div>
        ))}
        <button
          onClick={addDocument}
          className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300"
        >
          <Plus size={12} />
          Add another document
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-900/40 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {ingestBundle.isPending && (
        <div className="flex items-center gap-2 text-sm text-purple-300">
          <Loader2 size={14} className="animate-spin" />
          Chunking, embedding, and extracting entities... this takes ~30 seconds.
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-gray-800 pt-4">
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="flex items-center gap-2 rounded-xl bg-purple-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
        >
          {isPending ? <Loader2 size={14} className="animate-spin" /> : null}
          {createBundle.isPending ? 'Creating...' : ingestBundle.isPending ? 'Ingesting...' : 'Create & Ingest'}
        </button>
        <button
          onClick={onCancel}
          disabled={isPending}
          className="rounded-xl border border-gray-700 px-6 py-2.5 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
