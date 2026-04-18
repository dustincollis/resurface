// Shared helper for recording a Claude API call to ai_call_telemetry.
//
// Every edge function that calls api.anthropic.com/v1/messages should call
// `recordAiCall` after the response comes back (or fails). Insert errors
// are swallowed — telemetry must never break the caller.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface RecordAiCallArgs {
  user_id: string;
  function_name: string;
  model: string;
  usage: ClaudeUsage | undefined | null;
  stop_reason?: string | null;
  latency_ms?: number | null;
  source_type?: string | null;
  source_id?: string | null;
  metadata?: Record<string, unknown>;
}

// deno-lint-ignore no-explicit-any
export async function recordAiCall(adminClient: SupabaseClient<any, any, any>, args: RecordAiCallArgs): Promise<void> {
  try {
    const usage = args.usage ?? {};
    const { error } = await adminClient.from("ai_call_telemetry").insert({
      user_id: args.user_id,
      function_name: args.function_name,
      model: args.model,
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      stop_reason: args.stop_reason ?? null,
      latency_ms: args.latency_ms ?? null,
      source_type: args.source_type ?? null,
      source_id: args.source_id ?? null,
      metadata: args.metadata ?? {},
    });
    if (error) console.error("[telemetry] insert failed:", error);
  } catch (err) {
    console.error("[telemetry] unexpected error:", err);
  }
}
