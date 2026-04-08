export type ItemStatus = 'open' | 'in_progress' | 'waiting' | 'done' | 'dropped'

export interface FieldTemplate {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select'
  options?: string[]
}

export interface Stream {
  id: string
  user_id: string
  name: string
  color: string
  icon: string
  sort_order: number
  is_archived: boolean
  field_templates: FieldTemplate[]
  created_at: string
}

export interface Item {
  id: string
  user_id: string
  stream_id: string | null
  title: string
  description: string
  status: ItemStatus
  next_action: string | null
  resistance: number | null
  stakes: number | null
  last_touched_at: string
  staleness_score: number
  due_date: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  custom_fields: Record<string, unknown>
  ai_suggested_stream: string | null
  ai_confidence: number | null
  parent_id: string | null
  source_meeting_id: string | null
  // Joined fields
  streams?: Stream | null
}

export interface ActivityLogEntry {
  id: string
  user_id: string
  item_id: string | null
  action: string
  details: Record<string, unknown>
  created_at: string
}

export interface SearchResult {
  result_type: 'item' | 'meeting'
  result_id: string
  title: string
  snippet: string
  stream_name: string | null
  status: string | null
  rank: number
}

export interface CreateItemPayload {
  title: string
  description?: string
  stream_id?: string | null
  status?: ItemStatus
  next_action?: string
  resistance?: number
  stakes?: number
  due_date?: string | null
  custom_fields?: Record<string, unknown>
  parent_id?: string | null
}

export interface UpdateItemPayload extends Partial<CreateItemPayload> {
  last_touched_at?: string
  completed_at?: string | null
}

export interface CreateStreamPayload {
  name: string
  color?: string
  icon?: string
  field_templates?: FieldTemplate[]
}

export interface UpdateStreamPayload extends Partial<CreateStreamPayload> {
  sort_order?: number
  is_archived?: boolean
}
