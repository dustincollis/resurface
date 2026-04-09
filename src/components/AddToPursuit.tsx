import { useState } from 'react'
import { Target, Plus, Check, X, Loader2 } from 'lucide-react'
import {
  usePursuits,
  useAddPursuitMember,
  useRemovePursuitMember,
  useCreatePursuit,
  usePursuitsForMember,
} from '../hooks/usePursuits'
import type { PursuitMemberType } from '../lib/types'

interface AddToPursuitProps {
  memberType: PursuitMemberType
  memberId: string
  /** Compact: just the icon button. Full: shows current pursuits inline. */
  variant?: 'compact' | 'full'
}

export default function AddToPursuit({ memberType, memberId, variant = 'full' }: AddToPursuitProps) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const { data: allPursuits } = usePursuits({ status: 'active' })
  const { data: currentPursuits } = usePursuitsForMember(memberType, memberId)
  const addMember = useAddPursuitMember()
  const removeMember = useRemovePursuitMember()
  const createPursuit = useCreatePursuit()

  const memberPursuitIds = new Set((currentPursuits ?? []).map((p) => p.id))

  const handleToggle = (pursuitId: string) => {
    if (memberPursuitIds.has(pursuitId)) {
      removeMember.mutate({ pursuitId, memberType, memberId })
    } else {
      addMember.mutate({ pursuitId, memberType, memberId })
    }
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      const pursuit = await createPursuit.mutateAsync({ name: newName.trim() })
      await addMember.mutateAsync({
        pursuitId: pursuit.id,
        memberType,
        memberId,
      })
      setNewName('')
      setCreating(false)
    } catch (err) {
      // Likely a unique-name violation. Surface inline.
      const msg = err instanceof Error ? err.message : String(err)
      alert(`Could not create pursuit: ${msg}`)
    }
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-700 ${
          memberPursuitIds.size > 0 ? 'border-purple-700/60 text-purple-300' : ''
        }`}
        title="Add to pursuit"
      >
        <Target size={12} />
        {memberPursuitIds.size > 0
          ? `In ${memberPursuitIds.size} pursuit${memberPursuitIds.size !== 1 ? 's' : ''}`
          : 'Add to pursuit'}
      </button>

      {variant === 'full' && memberPursuitIds.size > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {(currentPursuits ?? []).map((p) => (
            <span
              key={p.id}
              className="flex items-center gap-1 rounded bg-purple-900/30 px-1.5 py-0.5 text-[10px] text-purple-300"
              style={{ borderLeft: `2px solid ${p.color}` }}
            >
              {p.name}
              <button
                onClick={() => handleToggle(p.id)}
                className="text-purple-400 hover:text-red-400"
                title="Remove from pursuit"
              >
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <>
          {/* Click-outside backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => {
              setOpen(false)
              setCreating(false)
              setNewName('')
            }}
          />
          <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-gray-700 bg-gray-900 shadow-lg">
            <div className="border-b border-gray-800 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-gray-500">
              Add to pursuit
            </div>
            <div className="max-h-64 overflow-y-auto">
              {(allPursuits ?? []).length === 0 && !creating && (
                <div className="px-3 py-4 text-xs text-gray-500">
                  No active pursuits yet. Create one below.
                </div>
              )}
              {(allPursuits ?? []).map((p) => {
                const inPursuit = memberPursuitIds.has(p.id)
                return (
                  <button
                    key={p.id}
                    onClick={() => handleToggle(p.id)}
                    disabled={addMember.isPending || removeMember.isPending}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-50"
                  >
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="flex-1 truncate">{p.name}</span>
                    {inPursuit && <Check size={12} className="text-purple-400" />}
                  </button>
                )
              })}
            </div>
            <div className="border-t border-gray-800 p-2">
              {creating ? (
                <div className="space-y-2">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    placeholder="Pursuit name..."
                    autoFocus
                    className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={handleCreate}
                      disabled={!newName.trim() || createPursuit.isPending}
                      className="flex flex-1 items-center justify-center gap-1 rounded bg-purple-600 px-2 py-1 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                    >
                      {createPursuit.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                      Create + add
                    </button>
                    <button
                      onClick={() => {
                        setCreating(false)
                        setNewName('')
                      }}
                      className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-200"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-purple-400 hover:bg-gray-800 hover:text-purple-300"
                >
                  <Plus size={11} />
                  New pursuit
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
