import { useState } from 'react'
import { Layers, ArrowRight, Plus, X } from 'lucide-react'
import { useCreateStream } from '../hooks/useStreams'

const SUGGESTED_STREAMS = [
  { name: 'Work', color: '#3B82F6' },
  { name: 'Personal', color: '#22C55E' },
  { name: 'Side Projects', color: '#8B5CF6' },
  { name: 'Health', color: '#EF4444' },
  { name: 'Finance', color: '#EAB308' },
  { name: 'Learning', color: '#06B6D4' },
]

interface OnboardingWizardProps {
  onComplete: () => void
}

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [customName, setCustomName] = useState('')
  const createStream = useCreateStream()

  const toggleStream = (name: string) => {
    const next = new Set(selected)
    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
    }
    setSelected(next)
  }

  const addCustom = () => {
    if (customName.trim()) {
      setSelected(new Set([...selected, customName.trim()]))
      setCustomName('')
    }
  }

  const handleFinish = async () => {
    for (const name of selected) {
      const suggested = SUGGESTED_STREAMS.find((s) => s.name === name)
      await createStream.mutateAsync({
        name,
        color: suggested?.color ?? '#6B7280',
      })
    }
    onComplete()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-lg">
        {step === 0 && (
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-600/20">
              <Layers size={32} className="text-purple-400" />
            </div>
            <h1 className="mb-2 text-3xl font-semibold text-white">Welcome to Resurface</h1>
            <p className="mb-8 text-gray-400">
              Your AI-powered task management system. Let&apos;s get you set up with some work streams.
            </p>
            <button
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-6 py-3 font-medium text-white hover:bg-purple-500"
            >
              Get Started <ArrowRight size={18} />
            </button>
            <button
              onClick={onComplete}
              className="mt-4 block w-full text-sm text-gray-500 hover:text-gray-300"
            >
              Skip for now
            </button>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="mb-2 text-xl font-semibold text-white">Create your streams</h2>
            <p className="mb-6 text-sm text-gray-400">
              Streams are categories for your work. Select some suggestions or add your own.
            </p>

            <div className="mb-4 grid grid-cols-2 gap-2">
              {SUGGESTED_STREAMS.map((stream) => (
                <button
                  key={stream.name}
                  onClick={() => toggleStream(stream.name)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                    selected.has(stream.name)
                      ? 'border-purple-500 bg-purple-600/10 text-white'
                      : 'border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: stream.color }}
                  />
                  {stream.name}
                </button>
              ))}
            </div>

            {/* Custom stream input */}
            <div className="mb-6 flex gap-2">
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustom()}
                placeholder="Add a custom stream..."
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              />
              <button
                onClick={addCustom}
                disabled={!customName.trim()}
                className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-white disabled:opacity-50"
              >
                <Plus size={16} />
              </button>
            </div>

            {/* Custom selections */}
            {[...selected].filter((s) => !SUGGESTED_STREAMS.find((ss) => ss.name === s)).length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {[...selected]
                  .filter((s) => !SUGGESTED_STREAMS.find((ss) => ss.name === s))
                  .map((name) => (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1 rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-300"
                    >
                      {name}
                      <button onClick={() => toggleStream(name)} className="text-gray-500 hover:text-red-400">
                        <X size={14} />
                      </button>
                    </span>
                  ))}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleFinish}
                disabled={selected.size === 0 || createStream.isPending}
                className="flex-1 rounded-lg bg-purple-600 px-4 py-2.5 font-medium text-white hover:bg-purple-500 disabled:opacity-50"
              >
                {createStream.isPending ? 'Creating...' : `Create ${selected.size} stream${selected.size !== 1 ? 's' : ''}`}
              </button>
              <button
                onClick={onComplete}
                className="rounded-lg px-4 py-2.5 text-sm text-gray-500 hover:text-gray-300"
              >
                Skip
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
