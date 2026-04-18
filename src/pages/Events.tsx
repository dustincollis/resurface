import { useState } from 'react'
import { useNavigate, NavLink } from 'react-router-dom'
import { Calendar, ChevronLeft, Plus, Loader2, Trash2 } from 'lucide-react'
import { useBundles, useDeleteBundle } from '../hooks/useBundles'
import BundleCreateForm from '../components/BundleCreateForm'
import type { Bundle } from '../lib/types'

const STATUS_COLORS: Record<Bundle['status'], string> = {
  draft: 'text-gray-500 bg-gray-800',
  ingesting: 'text-yellow-400 bg-yellow-950/40',
  ready: 'text-green-400 bg-green-950/40',
  error: 'text-red-400 bg-red-950/40',
}

export default function Events() {
  const { data: bundles, isLoading } = useBundles()
  const deleteBundle = useDeleteBundle()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleCreated = (bundleId: string) => {
    navigate(`/events/${bundleId}`)
  }

  const handleDelete = async (bundleId: string) => {
    if (!confirm('Delete this bundle and all its content?')) return
    setDeletingId(bundleId)
    deleteBundle.mutate(bundleId, {
      onSettled: () => setDeletingId(null),
    })
  }

  if (creating) {
    return (
      <div className="min-h-screen bg-gray-950">
        <div className="border-b border-gray-800 px-4 py-3">
          <button
            onClick={() => setCreating(false)}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300"
          >
            <ChevronLeft size={14} />
            Back
          </button>
        </div>
        <BundleCreateForm
          onCreated={handleCreated}
          onCancel={() => setCreating(false)}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <NavLink to="/" className="text-gray-500 hover:text-gray-300">
            <ChevronLeft size={16} />
          </NavLink>
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-purple-400" />
            <span className="text-sm font-semibold text-white">Events</span>
          </div>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-xl bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500"
        >
          <Plus size={12} />
          New Event
        </button>
      </div>

      {/* List */}
      <div className="p-4">
        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 size={20} className="animate-spin text-gray-600" />
          </div>
        )}

        {!isLoading && (!bundles || bundles.length === 0) && (
          <div className="flex flex-col items-center py-16 text-center">
            <Calendar size={32} className="mb-3 text-gray-700" />
            <p className="mb-1 text-sm text-gray-400">No event bundles yet</p>
            <p className="mb-4 text-xs text-gray-600">Create a bundle to prepare for your next event or onsite.</p>
            <button
              onClick={() => setCreating(true)}
              className="rounded-xl bg-purple-600 px-5 py-2 text-sm font-medium text-white hover:bg-purple-500"
            >
              Create your first bundle
            </button>
          </div>
        )}

        <div className="space-y-2">
          {bundles?.map((bundle) => (
            <div
              key={bundle.id}
              className="group flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3 hover:border-gray-700 hover:bg-gray-900"
            >
              <NavLink to={`/events/${bundle.id}`} className="flex flex-1 items-center gap-3 min-w-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">{bundle.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[bundle.status]}`}>
                      {bundle.status}
                    </span>
                  </div>
                  {bundle.description && (
                    <p className="mt-0.5 text-xs text-gray-500 truncate">{bundle.description}</p>
                  )}
                  {bundle.starts_at && (
                    <p className="mt-0.5 text-xs text-gray-600">
                      {new Date(bundle.starts_at).toLocaleDateString()}
                      {bundle.ends_at && ` — ${new Date(bundle.ends_at).toLocaleDateString()}`}
                    </p>
                  )}
                </div>
              </NavLink>
              <button
                onClick={() => handleDelete(bundle.id)}
                disabled={deletingId === bundle.id}
                className="opacity-0 group-hover:opacity-100 rounded p-1.5 text-gray-600 hover:text-red-400 transition-opacity"
              >
                {deletingId === bundle.id ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Trash2 size={13} />
                )}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
