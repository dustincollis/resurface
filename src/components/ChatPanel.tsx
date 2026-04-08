import { useState, useRef, useEffect, type KeyboardEvent, type ChangeEvent } from 'react'
import { X, Send, MessageSquare, Loader2, Paperclip, FileText, Image as ImageIcon } from 'lucide-react'
import { useChatMessages, useSendMessage, fileToAttachment, type FileAttachment } from '../hooks/useChat'

const ACCEPTED_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
  '.xlsx', '.pptx', '.docx',
].join(',')

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

function fileIcon(type: string) {
  if (type.startsWith('image/')) return <ImageIcon size={12} />
  return <FileText size={12} />
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

interface ChatPanelProps {
  isOpen: boolean
  onClose: () => void
}

export default function ChatPanel({ isOpen, onClose }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [pendingFiles, setPendingFiles] = useState<{ file: File; preview?: string }[]>([])
  const { data: messages, isLoading: messagesLoading } = useChatMessages()
  const sendMessage = useSendMessage()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const newFiles: { file: File; preview?: string }[] = []
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        alert(`${file.name} is too large. Max file size is 5MB.`)
        continue
      }

      let preview: string | undefined
      if (file.type.startsWith('image/')) {
        preview = URL.createObjectURL(file)
      }
      newFiles.push({ file, preview })
    }

    setPendingFiles((prev) => [...prev, ...newFiles])
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  const removeFile = (index: number) => {
    setPendingFiles((prev) => {
      const removed = prev[index]
      if (removed.preview) URL.revokeObjectURL(removed.preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleSend = async () => {
    const text = input.trim()
    if ((!text && pendingFiles.length === 0) || sendMessage.isPending) return

    // Convert files to base64 attachments
    let attachments: FileAttachment[] | undefined
    if (pendingFiles.length > 0) {
      attachments = await Promise.all(
        pendingFiles.map((pf) => fileToAttachment(pf.file))
      )
    }

    // Clean up previews
    pendingFiles.forEach((pf) => {
      if (pf.preview) URL.revokeObjectURL(pf.preview)
    })

    setInput('')
    setPendingFiles([])

    sendMessage.mutate({
      message: text,
      chatHistory: messages ?? [],
      attachments,
    })
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer.files
    if (!files.length) return

    const newFiles: { file: File; preview?: string }[] = []
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) continue
      let preview: string | undefined
      if (file.type.startsWith('image/')) {
        preview = URL.createObjectURL(file)
      }
      newFiles.push({ file, preview })
    }
    setPendingFiles((prev) => [...prev, ...newFiles])
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-y-0 right-0 z-40 flex w-96 flex-col border-l border-gray-800 bg-gray-900 shadow-2xl"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare size={18} className="text-purple-400" />
          <span className="text-sm font-medium text-white">AI Assistant</span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
        >
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messagesLoading ? (
          <div className="text-center text-sm text-gray-500">Loading chat...</div>
        ) : !messages || messages.length === 0 ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-gray-400">How can I help?</p>
            <div className="space-y-2">
              {[
                'What should I do next?',
                "What's getting stale?",
                'Summarize my open items',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion)
                    setTimeout(() => inputRef.current?.focus(), 50)
                  }}
                  className="block w-full rounded-lg border border-gray-700 px-3 py-2 text-left text-xs text-gray-400 hover:border-gray-600 hover:text-gray-300"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs text-gray-600">
              You can also attach images, PDFs, and documents for review.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-800 text-gray-200'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.actions_taken && msg.actions_taken.length > 0 && (
                    <div className="mt-2 border-t border-gray-700 pt-2">
                      {msg.actions_taken.map((action, i) => (
                        <p key={i} className="text-xs text-green-400">
                          {action}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {sendMessage.isPending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-400">
                  <Loader2 size={14} className="animate-spin" />
                  Thinking...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Pending files */}
      {pendingFiles.length > 0 && (
        <div className="border-t border-gray-800 px-4 py-2">
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((pf, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1"
              >
                {pf.preview ? (
                  <img src={pf.preview} alt="" className="h-6 w-6 rounded object-cover" />
                ) : (
                  fileIcon(pf.file.type)
                )}
                <span className="max-w-[120px] truncate text-xs text-gray-300">{pf.file.name}</span>
                <span className="text-xs text-gray-600">{formatSize(pf.file.size)}</span>
                <button
                  onClick={() => removeFile(i)}
                  className="text-gray-500 hover:text-red-400"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-800 px-4 py-3">
        {sendMessage.isError && (
          <p className="mb-2 text-xs text-red-400">
            Failed to send. Make sure the ai-chat edge function is deployed.
          </p>
        )}
        <div className="flex items-end gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
            title="Attach file (images, PDFs, documents — max 5MB)"
          >
            <Paperclip size={16} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES}
            onChange={handleFileSelect}
            className="hidden"
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything or drop files..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            style={{ maxHeight: '120px' }}
          />
          <button
            onClick={handleSend}
            disabled={(!input.trim() && pendingFiles.length === 0) || sendMessage.isPending}
            className="rounded-lg bg-purple-600 p-2 text-white hover:bg-purple-500 disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
