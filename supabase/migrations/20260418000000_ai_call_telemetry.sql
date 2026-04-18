-- ai_call_telemetry — per-Claude-call observability
--
-- Every edge function that talks to the Anthropic API writes one row here
-- on completion. Gives us durable cost + cache-hit-rate data that survives
-- Supabase's short log retention.

create table if not exists ai_call_telemetry (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,

  function_name text not null,
  model text not null,

  -- Anthropic usage breakdown
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_input_tokens int not null default 0,
  cache_creation_input_tokens int not null default 0,

  -- Call metadata
  stop_reason text,
  latency_ms int,

  -- Source linkage so we can jump from a cost row back to the meeting/input
  -- that generated it
  source_type text,
  source_id uuid,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists ai_call_telemetry_user_created_idx
  on ai_call_telemetry (user_id, created_at desc);

create index if not exists ai_call_telemetry_function_idx
  on ai_call_telemetry (function_name, created_at desc);

-- RLS — users read their own rows; edge functions insert via service role
-- (bypasses RLS).
alter table ai_call_telemetry enable row level security;

create policy "Users read own ai_call_telemetry"
  on ai_call_telemetry
  for select
  using (auth.uid() = user_id);
