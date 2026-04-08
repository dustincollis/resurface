import { useState } from 'react'
import { Save, RefreshCw, Download, CheckCircle, LogOut } from 'lucide-react'
import { useProfile, useUpdateProfile } from '../hooks/useProfile'
import { useSyncCalendar } from '../hooks/useMeetings'
import {
  getMicrosoftAuthorizeUrl,
  useSyncMicrosoft,
  useDisconnectMicrosoft,
  type MicrosoftConnection,
} from '../hooks/useMicrosoft'
import { supabase } from '../lib/supabase'

export default function Settings() {
  const { data: profile, isLoading } = useProfile()
  const updateProfile = useUpdateProfile()
  const syncCalendar = useSyncCalendar()
  const syncMicrosoft = useSyncMicrosoft()
  const disconnectMicrosoft = useDisconnectMicrosoft()

  const [displayName, setDisplayName] = useState<string | undefined>(undefined)
  const [icsUrl, setIcsUrl] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)

  const displayNameValue = displayName ?? profile?.display_name ?? ''
  const icsUrlValue = icsUrl ?? (profile?.settings?.ics_feed_url as string | undefined) ?? ''
  const microsoft = profile?.settings?.microsoft as MicrosoftConnection | undefined

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

  const handleConnectMicrosoft = () => {
    const url = getMicrosoftAuthorizeUrl()
    if (!url) {
      alert('Microsoft client ID not configured. Add VITE_MICROSOFT_CLIENT_ID and VITE_MICROSOFT_REDIRECT_URI to your environment.')
      return
    }
    window.location.href = url
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

        {/* Microsoft Outlook */}
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
            Microsoft Outlook
          </h2>

          {microsoft?.refresh_token ? (
            <>
              <div className="flex items-center gap-2">
                <CheckCircle size={16} className="text-green-400" />
                <span className="text-sm text-white">
                  Connected{microsoft.account_email ? ` as ${microsoft.account_email}` : ''}
                </span>
              </div>
              {microsoft.last_synced_at && (
                <p className="mt-1 text-xs text-gray-500">
                  Last synced: {new Date(microsoft.last_synced_at).toLocaleString()}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => syncMicrosoft.mutate()}
                  disabled={syncMicrosoft.isPending}
                  className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                >
                  <RefreshCw size={14} className={syncMicrosoft.isPending ? 'animate-spin' : ''} />
                  {syncMicrosoft.isPending ? 'Syncing...' : 'Sync Now'}
                </button>
                <button
                  onClick={() => disconnectMicrosoft.mutate()}
                  disabled={disconnectMicrosoft.isPending}
                  className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-red-400 disabled:opacity-50"
                >
                  <LogOut size={14} />
                  Disconnect
                </button>
              </div>
              {syncMicrosoft.isSuccess && syncMicrosoft.data && (
                <p className="mt-2 text-xs text-green-400">
                  Synced {syncMicrosoft.data.synced} event{syncMicrosoft.data.synced !== 1 ? 's' : ''}.
                </p>
              )}
              {syncMicrosoft.isError && (
                <p className="mt-2 text-xs text-red-400">
                  Sync failed. You may need to reconnect.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-gray-400">
                Connect your Microsoft account to automatically sync Outlook calendar events as discussions.
              </p>
              <button
                onClick={handleConnectMicrosoft}
                className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
              >
                Connect Microsoft Account
              </button>
              <p className="mt-2 text-xs text-gray-500">
                If you see a permissions error, your IT admin may need to approve the Resurface app for your organization.
              </p>
            </>
          )}
        </section>

        {/* ICS Calendar (fallback) */}
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
            Other Calendar (ICS Feed)
          </h2>
          <div>
            <label className="block text-sm font-medium text-gray-300">ICS Feed URL</label>
            <p className="mt-0.5 text-xs text-gray-500">
              Fallback for non-Microsoft calendars (Google Calendar, etc.). Paste a published ICS URL here.
            </p>
            <input
              type="url"
              value={icsUrlValue}
              onChange={(e) => setIcsUrl(e.target.value)}
              className="mt-2 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              placeholder="https://calendar.google.com/calendar/ical/..."
            />
          </div>

          {icsUrlValue && (
            <button
              onClick={() => syncCalendar.mutate()}
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

        {/* Data Export */}
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
            Data Export
          </h2>
          <p className="mb-3 text-sm text-gray-400">
            Download all your data as a JSON file.
          </p>
          <button
            onClick={async () => {
              const [items, streams, meetings, activities, chatMsgs] = await Promise.all([
                supabase.from('items').select('*'),
                supabase.from('streams').select('*'),
                supabase.from('meetings').select('*'),
                supabase.from('activity_log').select('*'),
                supabase.from('chat_messages').select('*'),
              ])
              const exportData = {
                exported_at: new Date().toISOString(),
                items: items.data,
                streams: streams.data,
                meetings: meetings.data,
                activity_log: activities.data,
                chat_messages: chatMsgs.data,
              }
              const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `resurface-export-${new Date().toISOString().split('T')[0]}.json`
              a.click()
              URL.revokeObjectURL(url)
            }}
            className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800"
          >
            <Download size={14} />
            Export All Data
          </button>
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
