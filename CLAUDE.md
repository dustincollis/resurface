# Resurface -- Claude Code Instructions

## Project Overview
Resurface is a multi-stream, AI-powered task management system.
See `docs/streamline-spec-v2.md` for the full technical specification.
Note: The spec and setup guide use the name "Streamline" throughout. The project has been renamed to "Resurface". Use "Resurface" in all UI text, branding, and user-facing strings.

## Tech Stack
- Frontend: React 19 (Vite 8) + TypeScript 6 + TanStack Query 5 + React Router 7
- Backend: Supabase (Postgres, Auth, Edge Functions, Storage, Realtime)
- AI: Claude API (claude-sonnet-4-20250514) via Supabase Edge Functions
- Hosting: Vercel (frontend), Supabase (backend)
- Styling: Tailwind CSS v4 (via @tailwindcss/vite plugin)
- Icons: lucide-react
- Drag and drop: @dnd-kit/core, @dnd-kit/sortable

## What Is Already Configured
- Supabase project is provisioned and linked (`supabase/` directory exists)
- Extensions enabled: pg_trgm, pgcrypto (do NOT enable pgvector, that is Phase 2)
- Supabase Auth configured: Email provider enabled, Site URL and redirects set for both localhost:5173 and the Vercel production URL
- Storage bucket `transcripts` created (private, with RLS policy for user-owned folders)
- Edge Function secrets are set: ANTHROPIC_API_KEY and SB_SERVICE_ROLE_KEY (note: the service role key uses the name SB_SERVICE_ROLE_KEY because Supabase reserves the SUPABASE_ prefix for secrets)
- Vercel project is connected to this repo with env vars configured (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
- Frontend scaffold: Vite + React + TypeScript initialized, all dependencies installed
- Frontend env vars are in `.env.local` (not committed)

## Project Structure
```
src/
  lib/           -- Supabase client, QueryClient, shared utilities
  contexts/      -- React contexts (AuthContext)
  hooks/         -- Custom hooks (useAuth, useRealtimeSubscription)
  components/    -- Shared components (Layout)
  pages/         -- Route-level page components
supabase/
  migrations/    -- SQL migration files
  functions/     -- Edge Functions (Deno/TypeScript)
docs/            -- Spec and setup guide
```

## Development Commands
- `npm run dev` -- start Vite dev server (port 5173)
- `npm run build` -- TypeScript check + Vite production build
- `npm run lint` -- run ESLint
- `supabase functions serve` -- serve Edge Functions locally
- `supabase db push` -- push migrations to remote
- `supabase functions deploy <name>` -- deploy a single Edge Function

## Build Order (from spec Section 11)
Follow the phase order strictly: 1A (foundation) through 1F (polish).

### Phase 1A -- Foundation (Days 1-3)
1. Database tables, RLS policies, indexes, search function (search_everything)
2. Auth flow (sign up, sign in, profile creation)
3. Frontend scaffold with routing and Supabase client
4. Realtime subscriptions for items, meetings, chat_messages
5. Deploy pipeline confirmed working

### Phase 1B -- Core Item Management (Days 4-7)
### Phase 1C -- Views & Visual Layer (Days 8-11)
### Phase 1D -- AI Chat (Days 12-14)
### Phase 1E -- Calendar & Transcripts (Days 15-18)
### Phase 1F -- Polish & Launch (Days 19-21)

See the spec for full details on each phase.

## Code Style
- Functional components only (no class components)
- Tailwind CSS for all styling (no CSS modules, no inline style objects)
- TypeScript strict mode
- Use lucide-react for icons

## Key Constraints
- All AI calls go through Edge Functions. The Anthropic API key is never in the frontend.
- Reference the Anthropic key in Edge Functions via `Deno.env.get('ANTHROPIC_API_KEY')`.
- Reference the service role key via `Deno.env.get('SB_SERVICE_ROLE_KEY')`.
- All tables use RLS. Users can only see their own data.
- The search function uses `security definer` with explicit user_id parameter.
- Edge Functions are Deno (TypeScript). Use Deno-compatible imports.
- ICS feed URL is sensitive (treat like a bearer token).
- Railway setup is deferred. Only needed if Edge Functions hit time limits on long transcripts.
