import type { ReactNode } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Activity,
  CalendarDays,
  ChevronRight,
  Check,
  Edit2,
  Handshake,
  Lightbulb,
  Target,
  Users,
  X,
} from 'lucide-react'
import { useState } from 'react'
import {
  useCompany,
  useCompanyPeople,
  useCompanyPursuits,
  useCompanyCommitments,
  useCompanyRollup,
  useCompanyJointPursuits,
  useUpdateCompany,
  type CompanyRollup,
  type JointPursuit,
} from '../hooks/useCompanies'
import type { CommitmentStatus, CompanyKind, PursuitStatus } from '../lib/types'
import Sparkline from '../components/Sparkline'

const PURSUIT_STYLE: Record<PursuitStatus, string> = {
  active: 'bg-purple-900/30 text-purple-300',
  won: 'bg-green-900/30 text-green-300',
  lost: 'bg-red-900/30 text-red-300',
  archived: 'bg-gray-800 text-gray-500',
}

const KIND_LABEL: Record<CompanyKind, string> = {
  partner: 'Partner',
  client: 'Client',
  internal: 'Internal',
  other: 'Other',
  unknown: 'Untagged',
}

const KIND_BADGE_STYLE: Record<CompanyKind, string> = {
  partner: 'bg-purple-900/30 text-purple-300 border-purple-800/50',
  client: 'bg-blue-900/30 text-blue-300 border-blue-800/50',
  internal: 'bg-gray-800 text-gray-400 border-gray-700',
  other: 'bg-gray-800 text-gray-400 border-gray-700',
  unknown: 'bg-gray-900 text-gray-600 border-gray-800',
}

const KIND_OPTIONS: CompanyKind[] = ['partner', 'client', 'internal', 'other', 'unknown']

const COMMITMENT_STYLE: Record<CommitmentStatus, string> = {
  open: 'bg-yellow-900/30 text-yellow-300',
  met: 'bg-green-900/30 text-green-300',
  broken: 'bg-red-900/30 text-red-300',
  cancelled: 'bg-gray-800 text-gray-500',
  waiting: 'bg-blue-900/30 text-blue-300',
  historical: 'bg-gray-800/50 text-gray-400',
}

function formatShortDate(iso: string | null | undefined) {
  if (!iso) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso))
}

function RollupList({
  title,
  icon,
  children,
  isEmpty,
  empty,
}: {
  title: string
  icon: ReactNode
  children: ReactNode
  isEmpty: boolean
  empty: string
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-gray-500">
        {icon}
        {title}
      </h3>
      <div className="space-y-1">
        {isEmpty ? <p className="text-xs italic text-gray-600">{empty}</p> : children}
      </div>
    </section>
  )
}

function JointPursuitRow({ jp }: { jp: JointPursuit }) {
  const status = jp.pursuit_status as PursuitStatus
  const breakdownParts: string[] = []
  if (jp.via_meetings > 0) breakdownParts.push(`${jp.via_meetings} meeting${jp.via_meetings === 1 ? '' : 's'}`)
  if (jp.via_commitments > 0)
    breakdownParts.push(`${jp.via_commitments} commitment${jp.via_commitments === 1 ? '' : 's'}`)
  if (jp.via_items > 0) breakdownParts.push(`${jp.via_items} item${jp.via_items === 1 ? '' : 's'}`)

  return (
    <Link
      to={`/pursuits/${jp.pursuit_id}`}
      className="flex items-center gap-3 rounded border border-gray-800 bg-gray-900 px-3 py-2 transition-colors hover:border-gray-700"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-white">{jp.pursuit_name}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${PURSUIT_STYLE[status] ?? 'bg-gray-800 text-gray-400'}`}>
            {status}
          </span>
        </div>
        {breakdownParts.length > 0 && (
          <div className="mt-0.5 text-[11px] text-gray-500">
            {jp.touch_count} touch{jp.touch_count === 1 ? '' : 'es'} · {breakdownParts.join(', ')}
          </div>
        )}
      </div>
      <ChevronRight size={14} className="shrink-0 text-gray-600" />
    </Link>
  )
}

function CompanyRollupCard({ rollup }: { rollup: CompanyRollup | null | undefined }) {
  if (!rollup) return null

  return (
    <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
          <div className="text-[11px] uppercase tracking-wider text-gray-600">People</div>
          <div className="mt-1 text-xl font-semibold text-white">{rollup.people_count}</div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
          <div className="text-[11px] uppercase tracking-wider text-gray-600">Open</div>
          <div className="mt-1 text-xl font-semibold text-white">
            {rollup.open_commitments_count}
          </div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
          <div className="text-[11px] uppercase tracking-wider text-gray-600">Ideas</div>
          <div className="mt-1 text-xl font-semibold text-white">{rollup.open_ideas_count}</div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
          <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-gray-600">
            <Activity size={11} />
            Momentum
          </div>
          <Sparkline values={rollup.weekly_momentum} className="text-purple-300" />
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <RollupList
          title="Recent Meetings"
          icon={<CalendarDays size={12} />}
          isEmpty={rollup.recent_meetings.length === 0}
          empty="No recent meetings."
        >
          {rollup.recent_meetings.slice(0, 5).map((meeting) => (
            <Link
              key={meeting.id}
              to={`/meetings/${meeting.id}`}
              className="block truncate text-xs text-gray-300 hover:text-white"
            >
              {meeting.title}
              <span className="text-gray-500"> - {formatShortDate(meeting.start_time)}</span>
            </Link>
          ))}
        </RollupList>

        <RollupList
          title="Open Commitments"
          icon={<Handshake size={12} />}
          isEmpty={rollup.open_commitments.length === 0}
          empty="No open commitments."
        >
          {rollup.open_commitments.slice(0, 5).map((commitment) => (
            <Link
              key={commitment.id}
              to="/commitments"
              className="block truncate text-xs text-gray-300 hover:text-white"
            >
              {commitment.title}
              {commitment.do_by && (
                <span className="text-gray-500"> - {formatShortDate(commitment.do_by)}</span>
              )}
            </Link>
          ))}
        </RollupList>

        <RollupList
          title="Surfaced Ideas"
          icon={<Lightbulb size={12} />}
          isEmpty={rollup.surfaced_ideas.length === 0}
          empty="No surfaced ideas."
        >
          {rollup.surfaced_ideas.slice(0, 5).map((idea) => (
            <Link
              key={idea.id}
              to="/ideas"
              className="block truncate text-xs text-gray-300 hover:text-white"
            >
              {idea.title}
            </Link>
          ))}
        </RollupList>
      </div>
    </div>
  )
}

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: company, isLoading } = useCompany(id)
  const { data: people } = useCompanyPeople(id)
  const { data: pursuits } = useCompanyPursuits(id)
  const { data: commitments } = useCompanyCommitments(id)
  const { data: rollup } = useCompanyRollup(id)
  const isPartner = company?.kind === 'partner'
  const { data: jointPursuits } = useCompanyJointPursuits(id, isPartner)
  const updateCompany = useUpdateCompany()

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDomain, setEditDomain] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editKind, setEditKind] = useState<CompanyKind>('unknown')

  const startEdit = () => {
    if (!company) return
    setEditName(company.name)
    setEditDomain(company.domain ?? '')
    setEditNotes(company.notes ?? '')
    setEditKind(company.kind)
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!company || !editName.trim()) return
    await updateCompany.mutateAsync({
      id: company.id,
      name: editName.trim(),
      domain: editDomain.trim() || null,
      notes: editNotes.trim() || null,
      kind: editKind,
    })
    setEditing(false)
  }

  if (isLoading) return <div className="text-sm text-gray-500">Loading...</div>
  if (!company) return <div className="text-sm text-gray-500">Company not found</div>

  return (
    <div className="mx-auto max-w-3xl">
      <button
        onClick={() => navigate('/companies')}
        className="mb-4 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"
      >
        <ArrowLeft size={14} /> Companies
      </button>

      {/* Header */}
      <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900 p-5">
        {editing ? (
          <div className="space-y-3">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-lg font-semibold text-white focus:border-purple-500 focus:outline-none"
            />
            <input
              value={editDomain}
              onChange={(e) => setEditDomain(e.target.value)}
              placeholder="Email domain (e.g. epam.com)"
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Notes..."
              rows={3}
              className="w-full resize-y rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs uppercase tracking-wider text-gray-500">Kind</label>
              <select
                value={editKind}
                onChange={(e) => setEditKind(e.target.value as CompanyKind)}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white focus:border-purple-500 focus:outline-none"
              >
                {KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={saveEdit} className="flex items-center gap-1 rounded bg-purple-600 px-3 py-1.5 text-sm text-white hover:bg-purple-500">
                <Check size={14} /> Save
              </button>
              <button onClick={() => setEditing(false)} className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200">
                <X size={14} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-white">{company.name}</h1>
                {company.kind !== 'unknown' && (
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${KIND_BADGE_STYLE[company.kind]}`}
                  >
                    {KIND_LABEL[company.kind]}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-3 text-sm text-gray-400">
                {company.domain && <span>{company.domain}</span>}
                <span>{(people ?? []).length} people</span>
                <span>{(pursuits ?? []).length} pursuits</span>
              </div>
              {company.notes && (
                <p className="mt-2 whitespace-pre-line text-sm text-gray-400">{company.notes}</p>
              )}
            </div>
            <button onClick={startEdit} className="rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300">
              <Edit2 size={14} />
            </button>
          </div>
        )}
      </div>

      <CompanyRollupCard rollup={rollup} />

      {/* Joint pursuits — partner-only section. Pursuits where this
          partner is mentioned or shared across meetings, commitments,
          or items. Active pursuits surface first; closed/lost are still
          shown so the user can see historical engagement. */}
      {isPartner && jointPursuits && jointPursuits.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            <Handshake size={12} /> Joint pursuits ({jointPursuits.length})
          </h2>
          <div className="space-y-1.5">
            {jointPursuits.map((jp) => (
              <JointPursuitRow key={jp.pursuit_id} jp={jp} />
            ))}
          </div>
        </section>
      )}
      {isPartner && jointPursuits && jointPursuits.length === 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            <Handshake size={12} /> Joint pursuits
          </h2>
          <p className="rounded border border-dashed border-gray-800 px-3 py-2 text-xs italic text-gray-600">
            No active pursuits mention this partner yet.
          </p>
        </section>
      )}

      {/* People */}
      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          <Users size={12} /> People ({(people ?? []).length})
        </h2>
        <div className="space-y-1">
          {(people ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/people/${p.id}`)}
              className="flex w-full items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2 text-left transition-colors hover:border-gray-700"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-900/30 text-xs font-medium text-purple-300">
                {p.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-sm text-gray-200">{p.name}</span>
                {p.role && <span className="ml-2 text-xs text-gray-500">{p.role}</span>}
              </div>
              <ChevronRight size={14} className="text-gray-600" />
            </button>
          ))}
        </div>
      </section>

      {/* Pursuits */}
      {(pursuits ?? []).length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            <Target size={12} /> Pursuits ({(pursuits ?? []).length})
          </h2>
          <div className="space-y-1">
            {(pursuits ?? []).map((p) => (
              <button
                key={p.id}
                onClick={() => navigate(`/pursuits/${p.id}`)}
                className="flex w-full items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2 text-left transition-colors hover:border-gray-700"
              >
                <span className="flex-1 truncate text-sm text-gray-200">{p.name}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${PURSUIT_STYLE[p.status as PursuitStatus]}`}>
                  {p.status}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Commitments */}
      {(commitments ?? []).length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            <Handshake size={12} /> Commitments ({(commitments ?? []).length})
          </h2>
          <div className="space-y-1">
            {(commitments ?? []).map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2"
              >
                <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${COMMITMENT_STYLE[c.status as CommitmentStatus]}`}>
                  {c.status}
                </span>
                <span className="flex-1 truncate text-sm text-gray-200">{c.title}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
