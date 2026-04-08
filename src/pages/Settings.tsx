import { useState } from 'react'
import { Save, RefreshCw } from 'lucide-react'
import { useProfile, useUpdateProfile } from '../hooks/useProfile'
import { useSyncCalendar } from '../hooks/useMeetings'

export default function Settings() {
  const { data: profile, isLoading } = useProfile()
  const updateProfile = useUpdateProfile()
  const syncCalendar = useSyncCalendar()

  const [displayName, setDisplayName] = useState<string | undefined>(undefined)
  const [icsUrl, setIcsUrl] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)

  // Derive values: use local state if user has edited, otherwise use profile data
  const displayNameValue = displayName ?? profile?.display_name ?? ''
  const icsUrlValue = icsUrl ?? (profile?.settings?.ics_feed_url as string | undefined) ?? ''

  const handleSave = () => {
    updateProfile.mutate({
      display_name: displayNameValue || undefined,
      settings: {
        ...profile?.settings,
        ics_feed_url: icsUrlValue || undefined,
      },
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSync = () => {
    syncCalendar.mutate()
  }

  if (isLoading) {
    return <div className="text-gray-400">Loading...</div>
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-6 text-2xl font-semibold text-white">Settings</h1>

      <div className="space-y-6">
        {/* Profile */}
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
            Profile
          </h2>
          <div>
            <label className="block text-sm font-medium text-gray-300">Display Name</label>
            <input
              type="text"
              value={displayNameValue}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              placeholder="Your name"
            />
          </div>
        </section>

        {/* Calendar */}
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
            Calendar Integration
          </h2>
          <div>
            <label className="block text-sm font-medium text-gray-300">ICS Feed URL</label>
            <p className="mt-0.5 text-xs text-gray-500">
              Publish your calendar as an ICS feed from Outlook or Google Calendar, then paste the URL here.
            </p>
            <input
              type="url"
              value={icsUrlValue}
              onChange={(e) => setIcsUrl(e.target.value)}
              className="mt-2 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              placeholder="https://outlook.office365.com/owa/calendar/..."
            />
          </div>

          {icsUrlValue && (
            <button
              onClick={handleSync}
              disabled={syncCalendar.isPending}
              className="mt-3 flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              <RefreshCw size={14} className={syncCalendar.isPending ? 'animate-spin' : ''} />
              {syncCalendar.isPending ? 'Syncing...' : 'Sync Now'}
            </button>
          )}
          {syncCalendar.isSuccess && (
            <p className="mt-2 text-xs text-green-400">Calendar synced successfully.</p>
          )}
          {syncCalendar.isError && (
            <p className="mt-2 text-xs text-red-400">
              Sync failed. Make sure the ics-sync edge function is deployed.
            </p>
          )}
        </section>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={updateProfile.isPending}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
          >
            <Save size={14} />
            {updateProfile.isPending ? 'Saving...' : 'Save Settings'}
          </button>
          {saved && <span className="text-sm text-green-400">Saved!</span>}
        </div>
      </div>
    </div>
  )
}
