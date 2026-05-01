# Resurface

Resurface is a single-user, AI-augmented work system for keeping sales pursuits, meeting follow-ups, commitments, and task context from disappearing after a full day of calls.

The canonical product and system reference is [docs/SPEC.md](docs/SPEC.md). Start there before making product or architecture changes.

## Stack

- React 19 + Vite + TypeScript
- TanStack Query + React Router
- Tailwind CSS v4, dark theme by default
- Supabase Postgres/Auth/Realtime/Edge Functions
- Claude API via Supabase Edge Functions

## Development

```sh
npm install
npm run dev
```

Useful checks:

```sh
npm run build
npm run lint
```

Deploy Edge Functions through the wrapper so functions keep the expected `--no-verify-jwt` behavior:

```sh
npm run deploy:functions
```

## Notes

- Frontend env vars live in `.env.local`.
- Supabase secrets are configured in the linked Supabase project.
- AI keys never go to the browser; all model calls go through Edge Functions.
