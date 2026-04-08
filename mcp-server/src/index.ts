#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

// ============================================================
// Configuration
// ============================================================

const supabaseUrl = process.env.RESURFACE_SUPABASE_URL
const supabaseAnonKey = process.env.RESURFACE_SUPABASE_ANON_KEY
const email = process.env.RESURFACE_EMAIL
const password = process.env.RESURFACE_PASSWORD

if (!supabaseUrl || !supabaseAnonKey || !email || !password) {
  console.error(
    'Missing required environment variables: RESURFACE_SUPABASE_URL, RESURFACE_SUPABASE_ANON_KEY, RESURFACE_EMAIL, RESURFACE_PASSWORD'
  )
  process.exit(1)
}

// ============================================================
// Supabase client + auth
// ============================================================

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
  },
})

let authedUserId: string | null = null

async function ensureAuthed(): Promise<string> {
  if (authedUserId) return authedUserId

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email!,
    password: password!,
  })

  if (error || !data.user) {
    throw new Error(`Supabase sign-in failed: ${error?.message ?? 'unknown error'}`)
  }

  authedUserId = data.user.id
  return authedUserId
}

// ============================================================
// Helpers
// ============================================================

function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  }
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  }
}

// ============================================================
// MCP Server
// ============================================================

const server = new McpServer({
  name: 'resurface',
  version: '0.1.0',
})

// ----- list_streams -----
server.tool(
  'list_streams',
  'List all of the user\'s active (non-archived) streams.',
  {},
  async () => {
    try {
      await ensureAuthed()
      const { data, error } = await supabase
        .from('streams')
        .select('id, name, color, icon, sort_order')
        .eq('is_archived', false)
        .order('sort_order')
      if (error) throw error
      return jsonResult(data)
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err))
    }
  }
)

// ----- list_items -----
server.tool(
  'list_items',
  'List items, optionally filtered by stream, status, or staleness. Returns up to 50 items.',
  {
    stream_name: z.string().optional().describe('Filter by stream name (case-insensitive)'),
    status: z
      .enum(['open', 'in_progress', 'waiting', 'done', 'dropped'])
      .optional()
      .describe('Filter by status'),
    sort_by: z
      .enum(['staleness_score', 'last_touched_at', 'due_date', 'created_at'])
      .optional()
      .default('staleness_score')
      .describe('Sort field'),
    limit: z.number().int().min(1).max(100).optional().default(20),
  },
  async ({ stream_name, status, sort_by, limit }) => {
    try {
      await ensureAuthed()

      let streamId: string | null = null
      if (stream_name) {
        const { data: streams } = await supabase
          .from('streams')
          .select('id, name')
        const match = streams?.find(
          (s) => s.name.toLowerCase() === stream_name.toLowerCase()
        )
        if (!match) {
          return errorResult(`Stream "${stream_name}" not found`)
        }
        streamId = match.id
      }

      let query = supabase
        .from('items')
        .select(
          'id, title, description, status, next_action, stream_id, staleness_score, due_date, resistance, stakes, last_touched_at, created_at, streams(name, color)'
        )

      if (streamId) query = query.eq('stream_id', streamId)
      if (status) query = query.eq('status', status)
      query = query.order(sort_by, { ascending: false }).limit(limit)

      const { data, error } = await query
      if (error) throw error
      return jsonResult(data)
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err))
    }
  }
)

// ----- get_item -----
server.tool(
  'get_item',
  'Get full detail for a single item by ID, including stream, parent, and source discussion.',
  {
    item_id: z.string().describe('The item UUID'),
  },
  async ({ item_id }) => {
    try {
      await ensureAuthed()
      const { data, error } = await supabase
        .from('items')
        .select(
          '*, streams(*), parent:items!parent_id(id, title), source_meeting:meetings!source_meeting_id(id, title)'
        )
        .eq('id', item_id)
        .single()
      if (error) throw error
      return jsonResult(data)
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err))
    }
  }
)

// ----- create_item -----
server.tool(
  'create_item',
  'Create a new item. AI classification runs in the background to suggest a stream if not provided.',
  {
    title: z.string().describe('The item title (required)'),
    description: z.string().optional(),
    stream_name: z.string().optional().describe('Stream name (resolved to id)'),
    next_action: z.string().optional(),
    due_date: z.string().optional().describe('YYYY-MM-DD'),
    parent_id: z.string().optional().describe('UUID of a parent item, if this is a sub-task'),
  },
  async ({ title, description, stream_name, next_action, due_date, parent_id }) => {
    try {
      const userId = await ensureAuthed()

      let stream_id: string | null = null
      if (stream_name) {
        const { data: streams } = await supabase.from('streams').select('id, name')
        const match = streams?.find(
          (s) => s.name.toLowerCase() === stream_name.toLowerCase()
        )
        if (match) stream_id = match.id
      }

      const { data, error } = await supabase
        .from('items')
        .insert({
          user_id: userId,
          title,
          description: description ?? '',
          stream_id,
          next_action: next_action ?? null,
          due_date: due_date ?? null,
          parent_id: parent_id ?? null,
        })
        .select()
        .single()

      if (error) throw error

      // Fire-and-forget AI classification (best effort)
      supabase.functions.invoke('ai-classify', { body: { item_id: data.id } }).catch(() => {})

      return jsonResult(data)
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err))
    }
  }
)

// ----- update_item -----
server.tool(
  'update_item',
  'Update fields on an existing item. Pass only the fields you want to change.',
  {
    item_id: z.string().describe('The item UUID'),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['open', 'in_progress', 'waiting', 'done', 'dropped']).optional(),
    next_action: z.string().optional(),
    stream_name: z.string().optional().describe('Stream name (resolved to id)'),
    due_date: z.string().nullable().optional().describe('YYYY-MM-DD or null to clear'),
    resistance: z.number().int().min(1).max(5).optional(),
    stakes: z.number().int().min(1).max(5).optional(),
  },
  async ({ item_id, stream_name, ...updates }) => {
    try {
      await ensureAuthed()

      const updateFields: Record<string, unknown> = { ...updates }

      if (stream_name !== undefined) {
        const { data: streams } = await supabase.from('streams').select('id, name')
        const match = streams?.find(
          (s) => s.name.toLowerCase() === stream_name.toLowerCase()
        )
        if (!match) {
          return errorResult(`Stream "${stream_name}" not found`)
        }
        updateFields.stream_id = match.id
      }

      // Handle completion timestamp
      if (updates.status === 'done' || updates.status === 'dropped') {
        updateFields.completed_at = new Date().toISOString()
      } else if (updates.status) {
        updateFields.completed_at = null
      }

      // Bump last_touched_at on any update
      updateFields.last_touched_at = new Date().toISOString()

      const { data, error } = await supabase
        .from('items')
        .update(updateFields)
        .eq('id', item_id)
        .select()
        .single()

      if (error) throw error
      return jsonResult(data)
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err))
    }
  }
)

// ----- search -----
server.tool(
  'search',
  'Search across items and discussions using full-text + fuzzy matching.',
  {
    query: z.string().describe('Search query (2+ characters)'),
    limit: z.number().int().min(1).max(50).optional().default(20),
  },
  async ({ query, limit }) => {
    try {
      const userId = await ensureAuthed()
      const { data, error } = await supabase.rpc('search_everything', {
        search_query: query,
        searching_user_id: userId,
        max_results: limit,
      })
      if (error) throw error
      return jsonResult(data)
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err))
    }
  }
)

// ----- get_dashboard -----
server.tool(
  'get_dashboard',
  'Get the daily cockpit: items needing attention by composite priority (staleness + stakes + due urgency).',
  {
    limit: z.number().int().min(1).max(50).optional().default(10),
  },
  async ({ limit }) => {
    try {
      await ensureAuthed()
      const { data, error } = await supabase
        .from('items')
        .select(
          'id, title, status, next_action, due_date, staleness_score, stakes, resistance, streams(name)'
        )
        .in('status', ['open', 'in_progress', 'waiting'])
        .order('staleness_score', { ascending: false })
        .limit(limit)
      if (error) throw error

      // Compute composite priority client-side
      const now = Date.now()
      const enriched = (data ?? []).map((item) => {
        const stalenessComponent = Math.min(item.staleness_score ?? 0, 100) * 0.4
        const stakesComponent = ((item.stakes ?? 3) / 5) * 100 * 0.3
        const resistanceComponent = ((6 - (item.resistance ?? 3)) / 5) * 100 * 0.1
        let dueComponent = 0
        if (item.due_date) {
          const daysUntilDue =
            (new Date(item.due_date).getTime() - now) / (1000 * 60 * 60 * 24)
          if (daysUntilDue < 0) dueComponent = 100
          else if (daysUntilDue < 1) dueComponent = 90
          else if (daysUntilDue < 3) dueComponent = 60
          else if (daysUntilDue < 7) dueComponent = 30
        }
        dueComponent *= 0.2
        const priority = stalenessComponent + stakesComponent + resistanceComponent + dueComponent
        return { ...item, priority_score: Math.round(priority) }
      })

      enriched.sort((a, b) => b.priority_score - a.priority_score)
      return jsonResult(enriched)
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err))
    }
  }
)

// ----- list_discussions -----
server.tool(
  'list_discussions',
  'List discussions (meetings) within a date range. Defaults to the last 14 days plus next 14 days.',
  {
    start_date: z.string().optional().describe('YYYY-MM-DD (default: 14 days ago)'),
    end_date: z.string().optional().describe('YYYY-MM-DD (default: 14 days from now)'),
    limit: z.number().int().min(1).max(100).optional().default(50),
  },
  async ({ start_date, end_date, limit }) => {
    try {
      await ensureAuthed()

      const start = start_date
        ? new Date(start_date).toISOString()
        : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
      const end = end_date
        ? new Date(end_date).toISOString()
        : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

      const { data, error } = await supabase
        .from('meetings')
        .select(
          'id, title, start_time, end_time, location, attendees, transcript_summary, processed_at'
        )
        .gte('start_time', start)
        .lte('start_time', end)
        .order('start_time', { ascending: false })
        .limit(limit)

      if (error) throw error
      return jsonResult(data)
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err))
    }
  }
)

// ----- get_discussion -----
server.tool(
  'get_discussion',
  'Get full detail for a single discussion, including transcript and extracted action items.',
  {
    discussion_id: z.string().describe('The discussion (meeting) UUID'),
  },
  async ({ discussion_id }) => {
    try {
      await ensureAuthed()
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .eq('id', discussion_id)
        .single()
      if (error) throw error
      return jsonResult(data)
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err))
    }
  }
)

// ============================================================
// Start server
// ============================================================

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Resurface MCP server running on stdio')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
