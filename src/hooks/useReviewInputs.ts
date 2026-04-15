import { useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from './useAuth'
import { buildUserContext, formatUserContextBlock } from '../lib/userContext'
import type { ReviewInput, ReviewInputType } from '../lib/types'

// Storage lives in the existing `transcripts` bucket. RLS on that bucket
// requires the first path segment to equal the user's id.
const STORAGE_BUCKET = 'transcripts'

function screenshotPath(userId: string, filename: string): string {
  const ext = (filename.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? 'png').toLowerCase()
  const uuid = crypto.randomUUID()
  return `${userId}/inputs/${uuid}.${ext}`
}

// Derive a title from the payload so the /proposals page has something
// short to display when filtered to this input.
function deriveTitle(args: {
  input_type: ReviewInputType
  file?: File | null
  raw_text?: string | null
  emailSubject?: string | null
}): string {
  if (args.input_type === 'email') {
    if (args.emailSubject && args.emailSubject.trim()) return args.emailSubject.trim()
    if (args.file?.name) return args.file.name
    return 'Email'
  }
  if (args.input_type === 'screenshot') {
    const now = new Date()
    const pretty = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    return `Screenshot from ${pretty}`
  }
  // pasted_text: first non-empty line, truncated
  const firstLine = (args.raw_text ?? '').split('\n').find((l) => l.trim())?.trim() ?? ''
  if (firstLine.length === 0) return 'Pasted text'
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine
}

// Best-effort email header parsing. We don't need a full MIME parser --
// we just want the Subject line for the title and From for metadata.
// The raw body still goes through the AI end-to-end, so imperfect header
// extraction is a display-only issue.
function parseEmailHeaders(raw: string): { subject: string | null; from: string | null; to: string | null; date: string | null } {
  const headerSection = raw.split(/\r?\n\r?\n/)[0] ?? ''
  const grab = (name: string) => {
    const match = headerSection.match(new RegExp(`^${name}:\\s*(.+?)(?:\\r?\\n(?![ \\t])|$)`, 'im'))
    return match ? match[1].trim() : null
  }
  return {
    subject: grab('Subject'),
    from: grab('From'),
    to: grab('To'),
    date: grab('Date'),
  }
}

interface CreateInputArgs {
  input_type: ReviewInputType
  user_description?: string | null
  // For pasted_text: the text. For email .eml upload: the full file contents.
  raw_text?: string | null
  // For screenshot + email file uploads.
  file?: File | null
}

export function useCreateReviewInput() {
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (args: CreateInputArgs) => {
      if (!user) throw new Error('not authenticated')

      let rawTextForDb: string | null = args.raw_text ?? null
      let storagePath: string | null = null
      let mimeType: string | null = null
      let metadata: Record<string, unknown> = {}
      let emailSubject: string | null = null

      if (args.input_type === 'screenshot') {
        if (!args.file) throw new Error('screenshot requires a file')
        mimeType = args.file.type || 'image/png'
        storagePath = screenshotPath(user.id, args.file.name)
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, args.file, {
            contentType: mimeType,
            upsert: false,
          })
        if (upErr) throw upErr
        metadata = { original_filename: args.file.name, size: args.file.size }
      } else if (args.input_type === 'email') {
        // Email payload can arrive as either a File (.eml drag-drop) or
        // as raw_text if the user pasted the body directly.
        if (args.file && !rawTextForDb) {
          rawTextForDb = await args.file.text()
        }
        if (!rawTextForDb) throw new Error('email input has no content')
        const headers = parseEmailHeaders(rawTextForDb)
        emailSubject = headers.subject
        metadata = {
          subject: headers.subject,
          from: headers.from,
          to: headers.to,
          date: headers.date,
          ...(args.file ? { original_filename: args.file.name } : {}),
        }
      } else if (args.input_type === 'pasted_text') {
        if (!rawTextForDb || !rawTextForDb.trim()) throw new Error('pasted text is empty')
      }

      const title = deriveTitle({
        input_type: args.input_type,
        file: args.file ?? null,
        raw_text: rawTextForDb,
        emailSubject,
      })

      const { data: insertedRow, error: insertErr } = await supabase
        .from('inputs')
        .insert({
          user_id: user.id,
          input_type: args.input_type,
          title,
          user_description: args.user_description?.trim() ? args.user_description.trim() : null,
          raw_text: rawTextForDb,
          storage_path: storagePath,
          mime_type: mimeType,
          metadata,
        })
        .select()
        .single()
      if (insertErr) throw insertErr
      const input = insertedRow as ReviewInput

      // Kick off parsing. The function reads the row itself, so we only
      // need to pass the input_id + user context.
      const userContext = formatUserContextBlock(buildUserContext())
      const { data: parseResult, error: parseErr } = await supabase.functions.invoke('ai-parse-input', {
        body: { input_id: input.id, user_context: userContext },
      })
      if (parseErr) {
        // Mirror useUploadTranscript's error surfacing so the UI can show
        // the function's detail message instead of a generic FunctionsError.
        const ctx = (parseErr as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json()
            const detail = body?.detail ?? body?.error ?? JSON.stringify(body)
            throw new Error(detail)
          } catch (inner) {
            if (inner instanceof Error && inner.message !== 'Failed to fetch') throw inner
          }
        }
        throw parseErr
      }

      return { input, result: parseResult as { proposals_created: number; commitments_created: number } }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inputs'] })
      queryClient.invalidateQueries({ queryKey: ['proposals'] })
    },
  })
}
