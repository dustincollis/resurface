import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import type { Stream, CreateStreamPayload, FieldTemplate } from '../lib/types'

const COLOR_PALETTE = [
  '#6B7280', '#EF4444', '#F97316', '#EAB308',
  '#22C55E', '#06B6D4', '#3B82F6', '#8B5CF6',
  '#EC4899', '#F43F5E',
]

interface StreamFormModalProps {
  stream?: Stream
  onSave: (payload: CreateStreamPayload) => void
  onClose: () => void
}

export default function StreamFormModal({ stream, onSave, onClose }: StreamFormModalProps) {
  const [name, setName] = useState(stream?.name ?? '')
  const [color, setColor] = useState(stream?.color ?? COLOR_PALETTE[0])
  const [fieldTemplates, setFieldTemplates] = useState<FieldTemplate[]>(
    stream?.field_templates ?? []
  )

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      color,
      field_templates: fieldTemplates,
    })
  }

  const addField = () => {
    setFieldTemplates([...fieldTemplates, { key: '', label: '', type: 'text' }])
  }

  const updateField = (index: number, updates: Partial<FieldTemplate>) => {
    setFieldTemplates(fieldTemplates.map((f, i) =>
      i === index ? { ...f, ...updates } : f
    ))
  }

  const removeField = (index: number) => {
    setFieldTemplates(fieldTemplates.filter((_, i) => i !== index))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {stream ? 'Edit Stream' : 'New Stream'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300">Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              placeholder="e.g. Sales Pipeline"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">Color</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 transition-all ${
                    color === c ? 'border-white scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-300">Custom Fields</label>
              <button
                type="button"
                onClick={addField}
                className="text-xs text-purple-400 hover:text-purple-300"
              >
                + Add field
              </button>
            </div>
            {fieldTemplates.length === 0 && (
              <p className="text-xs text-gray-500">No custom fields yet. AI can suggest these later.</p>
            )}
            <div className="space-y-2">
              {fieldTemplates.map((field, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={field.label}
                    onChange={(e) => updateField(i, {
                      label: e.target.value,
                      key: e.target.value.toLowerCase().replace(/\s+/g, '_'),
                    })}
                    placeholder="Label"
                    className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                  />
                  <select
                    value={field.type}
                    onChange={(e) => updateField(i, { type: e.target.value as FieldTemplate['type'] })}
                    className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white focus:border-purple-500 focus:outline-none"
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="select">Select</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    className="text-gray-500 hover:text-red-400"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
            >
              {stream ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
