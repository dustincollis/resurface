import { useMemo, useState } from 'react'
import { Inbox, Mail } from 'lucide-react'
import { useFollowUps } from '../hooks/useFollowUps'
import FollowUpCard from '../components/FollowUpCard'
import type { FollowUpStatus, FollowUpWithMeeting } from '../lib/types'

type BucketKey = 'today' | 'yesterday' | 'this_week' | 'older'

const BUCKET_LABELS: Record<BucketKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'Earlier this week',
  older: 'Older',
}

const BUCKET_ORDER: BucketKey[] = ['today', 'yesterday', 'this_week', 'older']

// Buckets are computed against local time (start of day) so a follow-up
// created at 11pm tonight stays in "Today" rather than jumping to "Yesterday"
// at midnight UTC. The header alone carries the lateness signal — no fading.
function bucketFor(createdAt: string): BucketKey {
  const created = new Date(createdAt)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)

  // Start of the current week (Monday). If today is Sunday, use Monday of last week.
  const day = startOfToday.getDay() // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day
  const startOfWeek = new Date(startOfToday)
  startOfWeek.setDate(startOfWeek.getDate() + diffToMonday)

  if (created >= startOfToday) return 'today'
  if (created >= startOfYesterday) return 'yesterday'
  if (created >= startOfWeek) return 'this_week'
  return 'older'
}

export default function FollowUps() {
  const [statusFilter, setStatusFilter] = useState<FollowUpStatus>('pending')
  const { data: followUps, isLoading } = useFollowUps({ status: statusFilter })

  const buckets = useMemo(() => {
    const map: Record<BucketKey, FollowUpWithMeeting[]> = {
      today: [],
      yesterday: [],
      this_week: [],
      older: [],
    }
    for (const f of followUps ?? []) {
      map[bucketFor(f.created_at)].push(f)
    }
    return map
  }, [followUps])

  const total = followUps?.length ?? 0

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Follow-Ups</h1>
          <p className="mt-1 text-sm text-gray-400">
            Post-meeting touches the AI thinks you should send. Copy, paste, send.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isLoading && (
            <span className="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300">
              {total} {statusFilter}
            </span>
          )}
        </div>
      </div>

      {/* Status switcher */}
      <div className="mb-6 inline-flex items-center rounded-lg border border-gray-800 bg-gray-900 p-1 text-xs">
        {(['pending', 'sent', 'dismissed'] as FollowUpStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded px-3 py-1 capitalize ${
              statusFilter === s
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : total === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 px-6 py-16 text-center">
          {statusFilter === 'pending' ? (
            <>
              <Inbox size={32} className="mx-auto text-gray-700" />
              <h2 className="mt-4 text-lg font-medium text-white">No follow-ups pending</h2>
              <p className="mt-1 text-sm text-gray-500">
                After your next meeting, the AI will draft any follow-ups it thinks you should send.
              </p>
            </>
          ) : (
            <>
              <Mail size={32} className="mx-auto text-gray-700" />
              <h2 className="mt-4 text-lg font-medium text-white">
                No {statusFilter} follow-ups yet
              </h2>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {BUCKET_ORDER.map((key) => {
            const items = buckets[key]
            if (items.length === 0) return null
            return (
              <section key={key}>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {BUCKET_LABELS[key]}{' '}
                  <span className="ml-1 text-gray-600">({items.length})</span>
                </h2>
                <div className="space-y-3">
                  {items.map((f) => (
                    <FollowUpCard key={f.id} followUp={f} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
