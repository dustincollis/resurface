import { useState, useEffect } from 'react'
import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { Search, LogOut, ChevronRight, ChevronDown, Plus } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useStreams } from '../hooks/useStreams'
import { useUncategorizedItems } from '../hooks/useItems'
import { useIdeaCounts } from '../hooks/useIdeas'
import SearchModal from './SearchModal'
import AddMenu from './AddMenu'

// Sidebar runs text-first: no per-row icons, typography carries nav weight.
// A short monospace timestamp under the wordmark sets the editorial/
// terminal voice used by chips and metadata throughout the app.
const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/focus', label: 'Focus' },
  { to: '/proposals', label: 'Proposals' },
  { to: '/follow-ups', label: 'Follow-Ups' },
  { to: '/commitments', label: 'Commitments' },
  { to: '/pursuits', label: 'Pursuits' },
  { to: '/goals', label: 'Goals' },
  { to: '/ideas', label: 'Ideas' },
  { to: '/meetings', label: 'Discussions' },
  { to: '/events', label: 'Events' },
]

const directoryItems = [
  { to: '/people', label: 'People' },
  { to: '/companies', label: 'Companies' },
  { to: '/streams', label: 'Streams' },
]

function formatSidebarTimestamp(d: Date): string {
  const day = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
  const mon = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
  const date = d.getDate()
  let h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  const ampm = h >= 12 ? 'P' : 'A'
  h = h % 12
  if (h === 0) h = 12
  return `${day} · ${mon} ${date} · ${h}:${m}${ampm}`
}

export default function Layout() {
  const { session, user, loading, signOut } = useAuth()
  const { data: streams } = useStreams()
  const { data: uncategorized } = useUncategorizedItems()
  const { data: ideaCounts } = useIdeaCounts()
  const [searchOpen, setSearchOpen] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const surfacedCount = ideaCounts?.surfaced ?? 0

  // Cmd+K / Ctrl+K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-gray-400">
        Loading...
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-gray-800 bg-gray-900">
        <div className="flex items-start justify-between px-4 pt-4 pb-3">
          <div>
            <div className="text-lg font-semibold tracking-tight text-white">Resurface</div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-gray-500">
              {formatSidebarTimestamp(new Date())}
            </div>
          </div>
          <button
            onClick={() => setSearchOpen(true)}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
            title="Search (Cmd+K)"
          >
            <Search size={15} />
          </button>
        </div>

        {/* Add — opens popover with Task / File / Paste options */}
        <div className="px-2 pt-1">
          <AddMenu
            align="right"
            order="capture"
            trigger={({ onClick, open }) => (
              <button
                onClick={onClick}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  open
                    ? 'bg-purple-700 text-white'
                    : 'bg-purple-600 text-white hover:bg-purple-500'
                }`}
              >
                <Plus size={16} />
                Add
              </button>
            )}
          />
        </div>

        {/* Main nav */}
        <nav className="space-y-0.5 px-2 py-1">
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                }`
              }
            >
              <span className="flex-1">{label}</span>
              {label === 'Ideas' && surfacedCount > 0 && (
                <span className="font-mono text-[10px] text-amber-300">
                  {surfacedCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Directory — collapsible section for People, Companies, Streams */}
        <div className="border-t border-gray-800 px-2 pt-2">
          <button
            onClick={() => setDirectoryOpen(!directoryOpen)}
            className="flex w-full items-center gap-2 px-3 py-1 text-xs font-medium uppercase tracking-wider text-gray-600 hover:text-gray-400"
          >
            {directoryOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            Directory
          </button>
          {directoryOpen && (
            <div className="mt-0.5 space-y-0.5">
              {directoryItems.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `block rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-gray-800 text-white'
                        : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </div>
          )}
        </div>

        {/* Stream shortcuts */}
        <div className="flex-1 overflow-y-auto border-t border-gray-800 px-2 py-2">
          {streams?.map((stream) => (
            <NavLink
              key={stream.id}
              to={`/stream/${stream.id}`}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-3 py-1 text-sm transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                }`
              }
            >
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: stream.color }}
              />
              <span className="truncate">{stream.name}</span>
            </NavLink>
          ))}
          <NavLink
            to="/stream/uncategorized"
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-3 py-1 text-sm transition-colors ${
                isActive
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-500 hover:bg-gray-800/50 hover:text-gray-300'
              }`
            }
          >
            <div className="h-2 w-2 rounded-full border border-dashed border-gray-600" />
            <span className="flex-1 truncate italic">Uncategorized</span>
            {uncategorized && uncategorized.length > 0 && (
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
                {uncategorized.length}
              </span>
            )}
          </NavLink>
        </div>

        {/* Bottom: settings + user */}
        <div className="border-t border-gray-800 px-2 py-2">
          <NavLink
            to="/settings"
            end
            className={({ isActive }) =>
              `block rounded-lg px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`
            }
          >
            Settings
          </NavLink>
          <NavLink
            to="/settings/analytics"
            className={({ isActive }) =>
              `block rounded-lg px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`
            }
          >
            Analytics
          </NavLink>
          <div className="mt-1 flex items-center justify-between px-3 py-1">
            <span className="truncate font-mono text-[10px] text-gray-500">
              {user?.email}
            </span>
            <button
              onClick={signOut}
              className="rounded p-1 text-gray-600 hover:bg-gray-800 hover:text-gray-300"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>

      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
