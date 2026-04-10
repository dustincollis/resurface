import { useState, useEffect } from 'react'
import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Layers, Calendar, Inbox, Handshake, Target, Flag, Settings, Search, LogOut, MessageSquare } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useStreams } from '../hooks/useStreams'
import { useUncategorizedItems } from '../hooks/useItems'
import SearchModal from './SearchModal'
import ChatPanel from './ChatPanel'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/proposals', icon: Inbox, label: 'Proposals' },
  { to: '/commitments', icon: Handshake, label: 'Commitments' },
  { to: '/pursuits', icon: Target, label: 'Pursuits' },
  { to: '/goals', icon: Flag, label: 'Goals' },
  { to: '/streams', icon: Layers, label: 'Streams' },
  { to: '/meetings', icon: Calendar, label: 'Discussions' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function Layout() {
  const { session, user, loading, signOut } = useAuth()
  const { data: streams } = useStreams()
  const { data: uncategorized } = useUncategorizedItems()
  const [searchOpen, setSearchOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(true)

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
      <aside className="flex w-60 flex-col border-r border-gray-800 bg-gray-900">
        <div className="flex h-14 items-center px-4 text-lg font-semibold tracking-tight">
          Resurface
        </div>

        <nav className="space-y-1 px-2 py-2">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Stream list */}
        <div className="flex-1 overflow-y-auto border-t border-gray-800 px-2 py-2">
          <div className="px-3 py-1 text-xs font-medium uppercase tracking-wider text-gray-600">
            Streams
          </div>
          {streams?.map((stream) => (
            <NavLink
              key={stream.id}
              to={`/stream/${stream.id}`}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
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
              `flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
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

        <div className="border-t border-gray-800 p-3">
          <div className="flex items-center justify-between">
            <span className="truncate text-sm text-gray-400">
              {user?.email}
            </span>
            <button
              onClick={signOut}
              className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 items-center gap-4 border-b border-gray-800 px-6">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex flex-1 items-center gap-2 rounded-lg bg-gray-800/50 px-3 py-1.5"
          >
            <Search size={16} className="text-gray-500" />
            <span className="text-sm text-gray-500">Search... (Cmd+K)</span>
          </button>
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className={`rounded-lg p-2 transition-colors ${
              chatOpen
                ? 'bg-purple-900/40 text-purple-300 border border-purple-800/50'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
            title="AI Chat"
          >
            <MessageSquare size={18} />
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>

      {/* Chat panel — flex sibling, pushes content when open */}
      <ChatPanel isOpen={chatOpen} onClose={() => setChatOpen(false)} />

      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
