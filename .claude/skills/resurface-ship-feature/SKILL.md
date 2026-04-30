---
name: resurface-ship-feature
description: Use this skill BEFORE any git push that ships Resurface changes to production. It runs a pre-flight checklist (build status, SPEC.md changelog dated for today, AUTO sections in sync, required skill invocations identified) and, if everything checks out, executes the deploys in the right order — supabase db push for migrations, npm run deploy:functions for changed edge functions, git push for the frontend (Vercel auto-deploys). Trigger this skill whenever the user says "deploy", "ship", "push everything", "release", "deploy means everything", or just after committing a feature. Don't run supabase db push or npm run deploy:functions manually for a multi-piece change — invoke this skill so the order is right and nothing is forgotten. Especially important because Dustin's "deploy" means everything (DB + functions + frontend), not just one piece.
---

# Resurface: Ship a feature

## What this skill does

Walks the full ship sequence so nothing gets forgotten:

1. **Pre-flight checks** (read-only — no changes to repo or remote):
   - Working tree clean (any uncommitted changes block the ship)
   - Build passes (`npm run build`)
   - SPEC.md has a changelog entry dated today
   - AUTO sections in SPEC.md are in sync (`node scripts/refresh-spec.mjs`)
   - Identifies which deploys are needed (migrations / edge functions / frontend)
   - Identifies which Claude Code skills MUST be invoked before push (per CLAUDE.md "Required Skill Invocations") based on what changed

2. **Ship actions** (only if `--ship` and pre-flight passed):
   - `supabase db push` if any new migrations
   - `npm run deploy:functions -- <names>` for each changed edge function (this script bakes in `--no-verify-jwt`, which is required)
   - `git push origin main` (triggers Vercel auto-deploy of the frontend)

## When to use

Trigger whenever the user asks to ship, deploy, or push something. Specifically:
- "deploy" / "deploy everything" / "ship it" / "push" / "release"
- After committing a feature, before pushing
- Anytime there's a multi-piece change (migration + function + frontend) that needs to land in the right order

Dustin has been bitten by partial deploys before. He said "when I ask you to deploy, I mean everything." This skill encodes that.

## How to use

Two modes:

**Check only (default — safe to run anytime):**
```bash
python3 .claude/skills/resurface-ship-feature/scripts/ship.py
```

**Check + ship (executes db push, function deploy, git push):**
```bash
python3 .claude/skills/resurface-ship-feature/scripts/ship.py --ship
```

### What the output looks like

```
━━━ Pre-flight ━━━
✓ Working tree clean
✓ Build passes (4.2s)
✓ SPEC.md changelog dated 2026-04-30
✓ AUTO sections in sync

━━━ Diff vs origin/main (3 commits ahead) ━━━
  migrations:     1 new (20260430010000_grouping.sql)
  edge functions: ai-parse-transcript (modified)
  frontend:       12 files (auto-deploys via Vercel on push)

━━━ Required skill invocations ━━━
  ⚠  claude-api      — ai-parse-transcript was modified
  ⚠  security-review — migration touches RLS, files include PII paths

━━━ Action plan ━━━
  1. supabase db push                           (1 migration)
  2. npm run deploy:functions -- ai-parse-transcript
  3. git push origin main

Run with --ship to execute. Or invoke the warned skills first.
```

## Why these defaults

- **Working tree must be clean**: committing is a thinking activity (scope, message). The skill assumes you've already done it. If there's uncommitted code, it tells you to commit first.
- **Migrations before functions before frontend**: this is the correct order for Resurface. A migration that adds a column needs to land before the function that uses the column. The function needs to be live before the frontend that calls it.
- **Skill invocations are warnings, not blockers**: the `claude-api` and `security-review` skills are *your* responsibility (Claude's), not the script's. The script tells you which apply; you invoke them before re-running with `--ship`.
- **Default mode is check-only**: zero-risk to run. Encourages frequent pre-flight checks during development.

## Implementation notes

- Project root: hardcoded to `/Users/dustincollis/resurface`. Update the constant if it moves.
- Diff base: `origin/main`. Fetches first to ensure it's current.
- Skill triggering rules: a file under `supabase/functions/**` triggers `claude-api`; anything under `supabase/functions/`, `supabase/migrations/`, `src/lib/supabase.ts`, `mcp-server/`, or RLS-related files triggers `security-review`. Mirrors the rules in CLAUDE.md.
- Failure modes:
  - `npm run build` fails → exit 1, no other actions taken
  - `supabase db push` fails → exit 1, function deploy and git push skipped (avoid leaving DB and code out of sync)
  - `npm run deploy:functions` fails → exit 1, git push skipped
  - `git push` fails → exit 1, but at this point DB and functions have already shipped (manual recovery needed; the script tells you)

## Extending the skill

If new shipping concerns emerge (changelog must mention specific tables, mandatory test suite, deploy-time smoke tests), add a check function to `ship.py`. Don't fork the workflow into multiple skills — one ship is one ship.
