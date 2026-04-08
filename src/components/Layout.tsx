import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Layers, Calendar, Settings, Search, LogOut } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/streams', icon: Layers, label: 'Streams' },
  { to: '/meetings', icon: Calendar, label: 'Meetings' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function Layout() {
  const { session, user, loading, signOut } = useAuth()

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

        <nav className="flex-1 space-y-1 px-2 py-2">
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
          <div className="flex flex-1 items-center gap-2 rounded-lg bg-gray-800/50 px-3 py-1.5">
            <Search size={16} className="text-gray-500" />
            <input
              type="text"
              placeholder="Search... (Cmd+K)"
              className="flex-1 bg-transparent text-sm text-gray-300 placeholder-gray-500 outline-none"
              readOnly
            />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
