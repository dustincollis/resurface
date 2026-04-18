# Resurface -- Claude Code Instructions

## Start Here
Read `docs/SPEC.md` first. It is the single source of truth for what Resurface is, what's built, and how it works. This file (`CLAUDE.md`) covers conventions, constraints, and dev commands only.

## Tech Stack (quick ref)
- Frontend: React 19 (Vite 8) + TypeScript 6 + TanStack Query 5 + React Router 7
- Backend: Supabase (Postgres 17, Auth, Edge Functions, Realtime)
- AI: Claude API (Opus 4.6 interactive, Sonnet 4.6 batch) via Supabase Edge Functions
- Hosting: Vercel (frontend), Supabase (backend)
- Styling: Tailwind CSS v4 (dark theme only, via @tailwindcss/vite plugin)
- Icons: lucide-react
- Drag and drop: @dnd-kit/core, @dnd-kit/sortable

## Project Structure
```
src/
  lib/           -- Supabase client, QueryClient, shared utilities
  contexts/      -- React contexts (AuthContext)
  hooks/         -- Custom hooks (data layer, all TanStack Query)
  components/    -- Shared components
  pages/         -- Route-level page components
supabase/
  migrations/    -- SQL migration files
  functions/     -- Edge Functions (Deno/TypeScript)
docs/            -- SPEC.md (canonical), legacy docs
mcp-server/      -- Local MCP server for Claude Desktop/Code
```

## Development Commands
- `npm run dev` -- start Vite dev server (port 5173)
- `npm run build` -- TypeScript check + Vite production build
- `npm run lint` -- run ESLint
- `supabase functions serve` -- serve Edge Functions locally
- `supabase db push` -- push migrations to remote
- `npm run deploy:functions` -- deploy all edge functions (or pass names: `npm run deploy:functions -- ai-parse-transcript ai-parse-input`). **Use this, not `supabase functions deploy` directly** — the script bakes in `--no-verify-jwt`, which every function in this repo requires (they handle auth in code; without the flag the gateway 401s webhook sources and breaks external integrations).

## Code Style
- Functional components only (no class components)
- Tailwind CSS for all styling (no CSS modules, no inline style objects)
- TypeScript strict mode
- Use lucide-react for icons
- Use "Resurface" in all UI text, branding, and user-facing strings

## Key Constraints
- All AI calls go through Edge Functions. The Anthropic API key is never in the frontend.
- Reference the Anthropic key in Edge Functions via `Deno.env.get('ANTHROPIC_API_KEY')`.
- Reference the service role key via `Deno.env.get('SB_SERVICE_ROLE_KEY')` (SB_ prefix because Supabase reserves SUPABASE_).
- All tables use RLS. Users can only see their own data.
- The search function uses `security definer` with explicit user_id parameter.
- Edge Functions are Deno (TypeScript). Use Deno-compatible imports.
- Edge Functions that serve AI features need `--no-verify-jwt` flag; they verify JWTs in-code.
- ICS feed URL is sensitive (treat like a bearer token).

## What Is Already Configured
- Supabase project provisioned and linked (`supabase/` directory)
- Extensions: pg_trgm, pgcrypto, pg_cron, pg_net, vector (pgvector — enabled for semantic search over meeting chunks)
- Supabase Auth: email provider, site URL + redirects for localhost:5173 and Vercel prod
- Storage bucket `transcripts` (private, RLS)
- Edge Function secrets set: ANTHROPIC_API_KEY, SB_SERVICE_ROLE_KEY, JAMIE_WEBHOOK_API_KEY, RESURFACE_DEFAULT_USER_ID, VOYAGE_API_KEY
- Vercel connected with env vars (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
- Frontend env vars in `.env.local` (not committed)

## Maintaining the Spec
**At the end of any session that ships a feature, migration, new page, new hook, or new Edge Function**:
1. Append a dated bullet to `docs/SPEC.md` > `## Changelog` describing what changed
2. If you added/removed routes, components, hooks, or Edge Functions, update the corresponding `<!-- AUTO:section -->` table in SPEC.md
3. If you changed the data model, update `## 15. Database Tables`
4. If you added a new AI capability, update `## 9. Item Intelligence`
5. Run `node scripts/refresh-spec.mjs` to verify AUTO sections are in sync (optional but recommended)
