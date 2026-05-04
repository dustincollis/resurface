import { useState, useEffect } from 'react'
import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { Search, LogOut, ChevronRight, ChevronDown, Plus, Menu, X } from 'lucide-react'
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
  { to: '/morning', label: 'Morning' },
  { to: '/focus', label: 'Focus' },
  { to: '/proposals', label: 'Proposals' },
  { to: '/follow-ups', label: 'Follow-Ups' },
  { to: '/commitments', label: 'Commitments' },
  { to: '/pursuits', label: 'Pursuits' },
  { to: '/goals', label: 'Goals' },
  { to: '/partners', label: 'Partners' },
  { to: '/themes', label: 'Themes' },
  { to: '/meetings', label: 'Discussions' },
  { to: '/events', label: 'Events' },
]

const directoryItems = [
  { to: '/people', label: 'People' },
  { to: '/companies', label: 'Companies' },
  { to: '/streams', label: 'Streams' },
]

const utilityItems = [
  { to: '/utility/prebriefs', label: 'Pre-Briefs' },
  { to: '/utility/momentum', label: 'Momentum' },
  { to: '/utility/quiet', label: 'Going Quiet' },
  { to: '/utility/similar', label: 'Similar' },
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
  const [utilityOpen, setUtilityOpen] = useState(false)
  // Mobile drawer state. On lg+ the sidebar is always visible; this is
  // ignored. On phone, the sidebar is a slide-in overlay controlled by
  // a hamburger button in the top bar.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
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
      {/* Mobile top bar — hamburger + brand + search. Hidden on lg+.
          On iOS PWA, the web view extends UNDER the status bar (clock /
          battery). Use safe-area-inset-top to push the bar's content
          below it; the bar's background still extends to the top edge
          so the status bar sits on a colored field, not on page content. */}
      <header
        className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 pb-2.5 lg:hidden"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.625rem)' }}
      >
        <button
          onClick={() => setMobileNavOpen(true)}
          className="rounded p-1.5 text-gray-300 hover:bg-gray-800 hover:text-white"
          title="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="text-base font-semibold tracking-tight text-white">Resurface</div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSearchOpen(true)}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
            title="Search"
          >
            <Search size={18} />
          </button>
        </div>
      </header>

      {/* Mobile drawer backdrop */}
      {mobileNavOpen && (
        <button
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      )}

      {/* Sidebar — always visible on lg+, slide-in drawer on mobile */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-gray-800 bg-gray-900 transition-transform duration-200 lg:static lg:w-56 lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-start justify-between px-4 pb-3 pt-[calc(env(safe-area-inset-top)+1rem)] lg:pt-4">
          <div>
            <div className="text-lg font-semibold tracking-tight text-white">Resurface</div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-gray-500">
              {formatSidebarTimestamp(new Date())}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSearchOpen(true)}
              className="rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
              title="Search (Cmd+K)"
            >
              <Search size={15} />
            </button>
            {/* Close button shown only on mobile — desktop has no need
                since the sidebar is always visible. */}
            <button
              onClick={() => setMobileNavOpen(false)}
              className="rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300 lg:hidden"
              title="Close menu"
              aria-label="Close menu"
            >
              <X size={16} />
            </button>
          </div>
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
              onClick={() => setMobileNavOpen(false)}
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
                  onClick={() => setMobileNavOpen(false)}
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

        {/* Utility — collapsible section for analytical surfaces */}
        <div className="border-t border-gray-800 px-2 pt-2">
          <button
            onClick={() => setUtilityOpen(!utilityOpen)}
            className="flex w-full items-center gap-2 px-3 py-1 text-xs font-medium uppercase tracking-wider text-gray-600 hover:text-gray-400"
          >
            {utilityOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            Utility
          </button>
          {utilityOpen && (
            <div className="mt-0.5 space-y-0.5">
              {utilityItems.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileNavOpen(false)}
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
              onClick={() => setMobileNavOpen(false)}
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
            onClick={() => setMobileNavOpen(false)}
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
            onClick={() => setMobileNavOpen(false)}
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
            onClick={() => setMobileNavOpen(false)}
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

      {/* Main content. On mobile, top padding accounts for the fixed
          mobile header (which itself includes the safe-area-inset-top
          for iOS status bar). On lg+, the header is hidden so no offset. */}
      <div className="flex flex-1 flex-col overflow-hidden pt-[calc(env(safe-area-inset-top)+3rem)] lg:pt-0">
        <main className="flex-1 overflow-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
