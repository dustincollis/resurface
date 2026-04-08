import { useState } from 'react'
import { Save, RefreshCw, Download, CheckCircle, LogOut, Trash2, Brain } from 'lucide-react'
import { useProfile, useUpdateProfile, useDistillProfile } from '../hooks/useProfile'
import { useSyncCalendar } from '../hooks/useMeetings'
import { useMemories, useDeleteMemory } from '../hooks/useMemories'
import {
  getMicrosoftAuthorizeUrl,
  useSyncMicrosoft,
  useDisconnectMicrosoft,
  type MicrosoftConnection,
} from '../hooks/useMicrosoft'
import { supabase } from '../lib/supabase'

const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const FULL_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// A subset of common IANA timezones; user can also paste a custom one
const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Australia/Sydney',
  'UTC',
]

function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export default function Settings() {
  const { data: profile, isLoading } = useProfile()
  const updateProfile = useUpdateProfile()
  const distillProfile = useDistillProfile()
  const syncCalendar = useSyncCalendar()
  const syncMicrosoft = useSyncMicrosoft()
  const disconnectMicrosoft = useDisconnectMicrosoft()
  const { data: memories } = useMemories()
  const deleteMemory = useDeleteMemory()

  const settings = (profile?.settings as Record<string, unknown>) ?? {}

  const [displayName, setDisplayName] = useState<string | undefined>(undefined)
  const [icsUrl, setIcsUrl] = useState<string | undefined>(undefined)
  const [bio, setBio] = useState<string | undefined>(undefined)
  const [timezone, setTimezone] = useState<string | undefined>(undefined)
  const [workingHoursStart, setWorkingHoursStart] = useState<string | undefined>(undefined)
  const [workingHoursEnd, setWorkingHoursEnd] = useState<string | undefined>(undefined)
  const [workingDays, setWorkingDays] = useState<number[] | undefined>(undefined)
  const [notifyOnMemory, setNotifyOnMemory] = useState<boolean | undefined>(undefined)
  const [saved, setSaved] = useState(false)

  const displayNameValue = displayName ?? profile?.display_name ?? ''
  const icsUrlValue = icsUrl ?? (settings.ics_feed_url as string | undefined) ?? ''
  const bioValue = bio ?? (settings.bio as string | undefined) ?? ''
  const timezoneValue = timezone ?? (settings.timezone as string | undefined) ?? detectBrowserTimezone()
  const workingHoursStartValue = workingHoursStart ?? (settings.working_hours_start as string | undefined) ?? '09:00'
  const workingHoursEndValue = workingHoursEnd ?? (settings.working_hours_end as string | undefined) ?? '17:00'
  const workingDaysValue = workingDays ?? (settings.working_days as number[] | undefined) ?? [1, 2, 3, 4, 5]
  const notifyOnMemoryValue = notifyOnMemory ?? (settings.notify_on_memory_added as boolean | undefined) ?? true
  const microsoft = settings.microsoft as MicrosoftConnection | undefined
  const bioDistilled = settings.bio_distilled as string | undefined
  const bioDistilledAt = settings.bio_distilled_at as string | undefined

  const toggleWorkingDay = (day: number) => {
    const next = workingDaysValue.includes(day)
      ? workingDaysValue.filter((d) => d !== day)
      : [...workingDaysValue, day].sort()
    setWorkingDays(next)
  }

  const handleSave = async () => {
    const previousBio = (settings.bio as string | undefined) ?? ''
    const bioChanged = bioValue !== previousBio

    await updateProfile.mutateAsync({
      display_name: displayNameValue || undefined,
      settings: {
        ...settings,
        ics_feed_url: icsUrlValue || undefined,
        bio: bioValue || undefined,
        timezone: timezoneValue,
        working_hours_start: workingHoursStartValue,
        working_hours_end: workingHoursEndValue,
        working_days: workingDaysValue,
        notify_on_memory_added: notifyOnMemoryValue,
      },
    })

    if (bioChanged) {
      // Fire-and-forget distill
      distillProfile.mutate()
    }

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

        {/* About You */}
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-gray-400">
            About You
          </h2>
          <p className="mb-3 text-xs text-gray-500">
            A description of who you are and what you work on. The AI uses this to give you better-targeted recommendations.
            Plain text. As short or long as you like &mdash; it&apos;ll be summarized automatically when you save.
          </p>
          <textarea
            value={bioValue}
            onChange={(e) => setBio(e.target.value)}
            rows={6}
            className="block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            placeholder="e.g. I'm a Strategy Director at a consulting firm, focused on healthcare clients..."
          />
          {bioDistilled && (
            <div className="mt-3 rounded-lg border border-purple-900/40 bg-purple-950/20 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-purple-400">
                <Brain size={11} />
                AI summary
              </div>
              <p className="text-xs text-gray-300">{bioDistilled}</p>
              {bioDistilledAt && (
                <p className="mt-1 text-[10px] text-gray-600">
                  Last refined: {new Date(bioDistilledAt).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </section>

        {/* Schedule */}
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
            Schedule
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300">Timezone</label>
              <select
                value={timezoneValue}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
              >
                {!COMMON_TIMEZONES.includes(timezoneValue) && (
                  <option value={timezoneValue}>{timezoneValue} (custom)</option>
                )}
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-300">Workday start</label>
                <input
                  type="time"
                  value={workingHoursStartValue}
                  onChange={(e) => setWorkingHoursStart(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300">Workday end</label>
                <input
                  type="time"
                  value={workingHoursEndValue}
                  onChange={(e) => setWorkingHoursEnd(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300">Working days</label>
              <div className="mt-2 flex gap-1.5">
                {DAY_NAMES.map((label, i) => {
                  const active = workingDaysValue.includes(i)
                  return (
                    <button
                      key={i}
                      onClick={() => toggleWorkingDay(i)}
                      title={FULL_DAY_NAMES[i]}
                      className={`h-9 w-9 rounded-lg border text-sm font-medium transition-colors ${
                        active
                          ? 'border-purple-500 bg-purple-600/20 text-purple-200'
                          : 'border-gray-700 bg-gray-800 text-gray-500 hover:border-gray-600'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Memories */}
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-gray-400">
            Memories
          </h2>
          <p className="mb-3 text-xs text-gray-500">
            Facts the AI has learned about you over time. You can delete any memory but can&apos;t edit them directly.
          </p>

          {memories && memories.length > 0 ? (
            <div className="mb-3 space-y-1.5">
              {memories.map((memory) => (
                <div
                  key={memory.id}
                  className="flex items-start gap-2 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2"
                >
                  <span className="flex-1 text-sm text-gray-300">{memory.content}</span>
                  <button
                    onClick={() => deleteMemory.mutate(memory.id)}
                    className="flex-shrink-0 text-gray-600 hover:text-red-400"
                    title="Delete memory"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mb-3 text-xs text-gray-600 italic">
              No memories yet. As you interact with the AI assistant, it will note things worth remembering.
            </p>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={notifyOnMemoryValue}
              onChange={(e) => setNotifyOnMemory(e.target.checked)}
              className="h-4 w-4 rounded border-gray-700 bg-gray-800 text-purple-600 focus:ring-purple-500 focus:ring-offset-0"
            />
            Tell me when the AI adds a new memory
          </label>
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
              const [items, streams, meetings, activities, chatMsgs, mems] = await Promise.all([
                supabase.from('items').select('*'),
                supabase.from('streams').select('*'),
                supabase.from('meetings').select('*'),
                supabase.from('activity_log').select('*'),
                supabase.from('chat_messages').select('*'),
                supabase.from('memories').select('*'),
              ])
              const exportData = {
                exported_at: new Date().toISOString(),
                items: items.data,
                streams: streams.data,
                meetings: meetings.data,
                activity_log: activities.data,
                chat_messages: chatMsgs.data,
                memories: mems.data,
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
        <div className="sticky bottom-0 -mx-6 flex items-center gap-3 border-t border-gray-800 bg-gray-950 px-6 py-4">
          <button
            onClick={handleSave}
            disabled={updateProfile.isPending}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
          >
            <Save size={14} />
            {updateProfile.isPending ? 'Saving...' : 'Save Settings'}
          </button>
          {saved && <span className="text-sm text-green-400">Saved!</span>}
          {distillProfile.isPending && (
            <span className="flex items-center gap-1 text-xs text-purple-400">
              <Brain size={12} className="animate-pulse" />
              Refining profile...
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
