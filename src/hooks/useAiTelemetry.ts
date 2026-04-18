import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { AiCallTelemetry } from '../lib/types'

// Anthropic list pricing (per million tokens). Adjust here when it moves.
// Cached reads are billed at ~10% of input; cache writes at ~125% (5m TTL).
interface Pricing {
  input: number
  output: number
}

const MODEL_PRICING: Record<string, Pricing> = {
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-opus-4-5': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

// Returns USD for a single row. Cached reads at 0.1x, cache writes at 1.25x.
export function estimateCost(row: AiCallTelemetry): number {
  const p = MODEL_PRICING[row.model]
  if (!p) return 0
  const perToken = (price: number) => price / 1_000_000
  const inputCost = row.input_tokens * perToken(p.input)
  const outputCost = row.output_tokens * perToken(p.output)
  const cacheReadCost = row.cache_read_input_tokens * perToken(p.input) * 0.1
  const cacheWriteCost = row.cache_creation_input_tokens * perToken(p.input) * 1.25
  return inputCost + outputCost + cacheReadCost + cacheWriteCost
}

// What the same input would have cost WITHOUT caching (for savings display).
export function estimateUncachedCost(row: AiCallTelemetry): number {
  const p = MODEL_PRICING[row.model]
  if (!p) return 0
  const perToken = (price: number) => price / 1_000_000
  const totalInputTokens =
    row.input_tokens + row.cache_read_input_tokens + row.cache_creation_input_tokens
  return totalInputTokens * perToken(p.input) + row.output_tokens * perToken(p.output)
}

interface UseAiTelemetryOptions {
  limit?: number
  functionName?: string
}

export function useAiTelemetry(opts: UseAiTelemetryOptions = {}) {
  const { user } = useAuth()
  const limit = opts.limit ?? 200

  return useQuery({
    queryKey: ['ai_call_telemetry', opts],
    queryFn: async () => {
      let q = supabase
        .from('ai_call_telemetry')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (opts.functionName) q = q.eq('function_name', opts.functionName)
      const { data, error } = await q
      if (error) throw error
      return data as AiCallTelemetry[]
    },
    enabled: !!user,
  })
}
