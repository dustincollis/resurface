import { useState, useEffect } from 'react'
import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Calendar, Inbox, Handshake, Target, Flag, Users, Building2, Layers, Settings, Search, LogOut, Crosshair, ChevronRight, ChevronDown } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useStreams } from '../hooks/useStreams'
import { useUncategorizedItems } from '../hooks/useItems'
import SearchModal from './SearchModal'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/focus', icon: Crosshair, label: 'Focus' },
  { to: '/proposals', icon: Inbox, label: 'Proposals' },
  { to: '/commitments', icon: Handshake, label: 'Commitments' },
  { to: '/pursuits', icon: Target, label: 'Pursuits' },
  { to: '/goals', icon: Flag, label: 'Goals' },
  { to: '/meetings', icon: Calendar, label: 'Discussions' },
]

const directoryItems = [
  { to: '/people', icon: Users, label: 'People' },
  { to: '/companies', icon: Building2, label: 'Companies' },
  { to: '/streams', icon: Layers, label: 'Streams' },
]

export default function Layout() {
  const { session, user, loading, signOut } = useAuth()
  const { data: streams } = useStreams()
  const { data: uncategorized } = useUncategorizedItems()
  const [searchOpen, setSearchOpen] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)

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
        <div className="flex h-12 items-center justify-between px-4">
          <span className="text-base font-semibold tracking-tight">Resurface</span>
          <button
            onClick={() => setSearchOpen(true)}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
            title="Search (Cmd+K)"
          >
            <Search size={15} />
          </button>
        </div>

        {/* Main nav */}
        <nav className="space-y-0.5 px-2 py-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                }`
              }
            >
              <Icon size={16} />
              {label}
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
              {directoryItems.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-gray-800 text-white'
                        : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                    }`
                  }
                >
                  <Icon size={16} />
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
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`
            }
          >
            <Settings size={16} />
            Settings
          </NavLink>
          <div className="mt-1 flex items-center justify-between px-3 py-1">
            <span className="truncate text-xs text-gray-500">
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
