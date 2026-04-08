import { queryClient } from './queryClient'
import type { Profile } from '../hooks/useProfile'

export interface Memory {
  id: string
  user_id: string
  content: string
  source: 'user_added' | 'extracted_from_chat' | 'extracted_from_transcript' | 'extracted_from_item'
  created_at: string
}

export interface UserContext {
  date: string // "Wednesday, April 8, 2026"
  time: string // "5:23 PM"
  timezone: string // IANA, "America/New_York"
  working_hours: { start: string; end: string }
  working_days: number[] // 0=Sunday..6=Saturday
  profile_block: string // multi-line markdown-ish block ready to inject into a system prompt
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function formatDateInZone(date: Date, timezone: string): { date: string; time: string; dayOfWeek: string } {
  const dateStr = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
  // Get day of week separately for working_days lookup
  const weekdayLong = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  }).format(date)
  return { date: dateStr, time: timeStr, dayOfWeek: weekdayLong }
}

function buildProfileBlock(profile: Profile | undefined, memories: Memory[]): string {
  const lines: string[] = []
  const settings = (profile?.settings as Record<string, unknown>) ?? {}
  const distilled = (settings.bio_distilled as string) || (settings.bio as string) || null

  if (distilled) {
    lines.push('USER PROFILE')
    lines.push('============')
    lines.push(distilled)
  }

  if (memories.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push('KNOWN FACTS ABOUT THE USER')
    lines.push('==========================')
    for (const memory of memories) {
      lines.push(`- ${memory.content}`)
    }
  }

  return lines.join('\n')
}

export function buildUserContext(): UserContext {
  // Read directly from query cache so any hook can call this
  const profile = queryClient.getQueryData<Profile>(['profile'])
  const memories = queryClient.getQueryData<Memory[]>(['memories']) ?? []

  const settings = (profile?.settings as Record<string, unknown>) ?? {}
  const timezone = (settings.timezone as string) || detectBrowserTimezone()
  const workingHoursStart = (settings.working_hours_start as string) || '09:00'
  const workingHoursEnd = (settings.working_hours_end as string) || '17:00'
  const workingDays = (settings.working_days as number[]) || [1, 2, 3, 4, 5]

  const now = new Date()
  const { date, time } = formatDateInZone(now, timezone)
  const profileBlock = buildProfileBlock(profile, memories)

  return {
    date,
    time,
    timezone,
    working_hours: { start: workingHoursStart, end: workingHoursEnd },
    working_days: workingDays,
    profile_block: profileBlock,
  }
}

// Format the user context as a single text block ready to inject into a system prompt.
// This is what gets sent over the wire to edge functions and embedded in prompts.
export function formatUserContextBlock(ctx: UserContext): string {
  const workingDayNames = ctx.working_days.map((d) => DAYS_OF_WEEK[d]).join(', ')
  const lines = [
    'CURRENT CONTEXT',
    '===============',
    `Today: ${ctx.date}`,
    `Current local time: ${ctx.time}`,
    `Timezone: ${ctx.timezone}`,
    `Working hours: ${ctx.working_hours.start} - ${ctx.working_hours.end}`,
    `Working days: ${workingDayNames}`,
  ]
  if (ctx.profile_block) {
    lines.unshift('')
    lines.unshift(ctx.profile_block)
  }
  return lines.join('\n')
}
