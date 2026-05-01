import { Link } from 'react-router-dom'
import { AlertCircle, Building2, Clock, Loader2, UserRound } from 'lucide-react'
import { useQuietThreads, type QuietThread } from '../../hooks/useQuietThreads'

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso))
}

function ThreadRow({ thread }: { thread: QuietThread }) {
  const href = thread.entity_type === 'person'
    ? `/people/${thread.entity_id}`
    : `/companies/${thread.entity_id}`
  const Icon = thread.entity_type === 'person' ? UserRound : Building2

  return (
    <Link
      to={href}
      className="block rounded-lg border border-gray-800 bg-gray-900 p-3 transition-colors hover:border-gray-700 hover:bg-gray-900/80"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon size={14} className="shrink-0 text-gray-600" />
            <div className="truncate text-sm font-medium text-gray-100">
              {thread.entity_name}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <Clock size={12} />
              Last mentioned {formatDate(thread.last_mention_at)}
            </span>
            <span>{thread.prior_mention_count} prior mentions</span>
          </div>
        </div>
        <div className="shrink-0 rounded border border-gray-800 px-2 py-1 text-xs text-gray-400">
          {thread.days_silent}d silent
        </div>
      </div>
    </Link>
  )
}

function ThreadSection({
  title,
  threads,
}: {
  title: string
  threads: QuietThread[]
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wider text-gray-500">
          {title}
        </h2>
        <span className="font-mono text-xs text-gray-600">{threads.length}</span>
      </div>
      {threads.length > 0 ? (
        <div className="space-y-2">
          {threads.map((thread) => (
            <ThreadRow key={`${thread.entity_type}:${thread.entity_id}`} thread={thread} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-800 p-4 text-sm text-gray-600">
          None.
        </div>
      )}
    </section>
  )
}

export default function Quiet() {
  const { data: threads, isLoading, error } = useQuietThreads()
  const people = (threads ?? [])
    .filter((thread) => thread.entity_type === 'person')
    .sort((a, b) => b.days_silent - a.days_silent || b.prior_mention_count - a.prior_mention_count)
  const companies = (threads ?? [])
    .filter((thread) => thread.entity_type === 'company')
    .sort((a, b) => b.days_silent - a.days_silent || b.prior_mention_count - a.prior_mention_count)

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Going Quiet</h1>
        <p className="mt-1 text-sm text-gray-500">
          Active people and companies with no recent mentions.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading quiet threads...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <AlertCircle size={16} />
            Quiet threads failed
          </div>
          <p className="text-red-200/80">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      )}

      {!isLoading && !error && threads?.length === 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-500">
          Nothing has gone quiet - all your active threads have recent activity.
        </div>
      )}

      {!isLoading && !error && threads && threads.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2">
          <ThreadSection title="People" threads={people} />
          <ThreadSection title="Companies" threads={companies} />
        </div>
      )}
    </div>
  )
}
