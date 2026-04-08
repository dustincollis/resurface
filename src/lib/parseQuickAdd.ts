import type { Stream } from './types'

interface ParsedQuickAdd {
  title: string
  stream_id?: string
  due_date?: string
}

export function parseQuickAdd(input: string, streams: Stream[]): ParsedQuickAdd {
  let text = input.trim()
  let stream_id: string | undefined
  let due_date: string | undefined

  // Extract #StreamName
  const streamMatch = text.match(/#(\S+)/)
  if (streamMatch) {
    const streamName = streamMatch[1].toLowerCase()
    const matched = streams.find(
      (s) => s.name.toLowerCase() === streamName || s.name.toLowerCase().startsWith(streamName)
    )
    if (matched) {
      stream_id = matched.id
    }
    text = text.replace(streamMatch[0], '').trim()
  }

  // Extract due:YYYY-MM-DD or due:today/tomorrow
  const dueMatch = text.match(/due:(\S+)/i)
  if (dueMatch) {
    const dueStr = dueMatch[1].toLowerCase()
    const today = new Date()

    if (dueStr === 'today') {
      due_date = today.toISOString().split('T')[0]
    } else if (dueStr === 'tomorrow') {
      today.setDate(today.getDate() + 1)
      due_date = today.toISOString().split('T')[0]
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dueStr)) {
      due_date = dueStr
    }

    text = text.replace(dueMatch[0], '').trim()
  }

  return {
    title: text,
    stream_id,
    due_date,
  }
}
