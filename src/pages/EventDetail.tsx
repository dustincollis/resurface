import { useState } from 'react'
import { useParams, NavLink } from 'react-router-dom'
import { ChevronLeft, FileText, MessageSquare, FolderOpen, Loader2, WifiOff } from 'lucide-react'
import { useBundle } from '../hooks/useBundles'
import BundleReport from '../components/BundleReport'
import BundleChat from '../components/BundleChat'
import BundleSource from '../components/BundleSource'

type Tab = 'report' | 'query' | 'source'

const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: 'report', label: 'Report', icon: FileText },
  { id: 'query', label: 'Query', icon: MessageSquare },
  { id: 'source', label: 'Source', icon: FolderOpen },
]

export default function EventDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: bundle, isLoading } = useBundle(id!)
  const [tab, setTab] = useState<Tab>('report')
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <Loader2 size={20} className="animate-spin text-gray-600" />
      </div>
    )
  }

  if (!bundle) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-950">
        <p className="mb-4 text-sm text-gray-400">Bundle not found</p>
        <NavLink to="/events" className="text-xs text-purple-400 hover:text-purple-300">
          Back to Events
        </NavLink>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-gray-950">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-3 print:hidden">
        <NavLink to="/events" className="flex-shrink-0 text-gray-500 hover:text-gray-300">
          <ChevronLeft size={16} />
        </NavLink>
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-sm font-semibold text-white">{bundle.name}</h1>
          {bundle.description && (
            <p className="truncate text-xs text-gray-500">{bundle.description}</p>
          )}
        </div>
        {bundle.status === 'ingesting' && (
          <div className="flex items-center gap-1.5 text-xs text-yellow-400">
            <Loader2 size={12} className="animate-spin" />
            Ingesting...
          </div>
        )}
        {bundle.status === 'error' && (
          <span className="text-xs text-red-400">Ingest error</span>
        )}
      </div>

      {/* Offline banner (only on query tab) */}
      {isOffline && tab === 'query' && (
        <div className="flex items-center gap-2 border-b border-yellow-900/40 bg-yellow-950/30 px-4 py-2 print:hidden">
          <WifiOff size={13} className="text-yellow-400" />
          <span className="text-xs text-yellow-300">Reading offline — query unavailable</span>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-hidden print:overflow-visible">
        {tab === 'report' && <BundleReport bundleId={bundle.id} />}
        {tab === 'query' && (
          isOffline ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center px-8">
              <WifiOff size={32} className="text-gray-700" />
              <p className="text-sm text-gray-400">Query requires an internet connection.</p>
              <p className="text-xs text-gray-600">Switch to the Report or Source tab to read offline.</p>
            </div>
          ) : (
            <BundleChat bundleId={bundle.id} />
          )
        )}
        {tab === 'source' && <BundleSource bundleId={bundle.id} />}
      </div>

      {/* Bottom tab bar — mobile-first */}
      <div className="flex border-t border-gray-800 bg-gray-900 print:hidden">
        {TABS.map(({ id: tabId, label, icon: Icon }) => (
          <button
            key={tabId}
            onClick={() => setTab(tabId)}
            className={`flex flex-1 flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${
              tab === tabId
                ? 'text-purple-400 border-t-2 border-purple-500 -mt-0.5'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
