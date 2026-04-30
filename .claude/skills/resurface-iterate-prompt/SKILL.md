---
name: resurface-iterate-prompt
description: Use this skill to iterate fast on the Resurface ai-parse-transcript edge function — deploy the function and re-parse a list of meetings to see how the new prompt or extraction logic actually behaves on real transcripts. Trigger this whenever editing supabase/functions/ai-parse-transcript/index.ts (especially the system prompt, follow-up extraction, action item rules, response schema, or model selection), whenever the user asks to "re-parse" / "test the parser" / "see what the model does now" / "try it on today's meetings" / "deploy and check", or whenever you've just changed extraction behavior and want to verify on a sample of recent meetings. Don't write inline curl/JWT/python boilerplate to do this — invoke this skill instead. The script handles Supabase auth, optional deploy, sequential reparse, and per-meeting output summaries with deltas against the prior run.
---

# Resurface: Iterate on the parser prompt

## What this skill does

Wraps the manual five-step iteration loop into one command:

1. Deploys `ai-parse-transcript` (skippable with `--no-deploy`)
2. Signs in to Supabase as the user (using credentials from the local Claude Desktop MCP config)
3. Re-parses the requested meetings via the edge function
4. Pulls the resulting pending `follow_ups` row (subject + first line of body + recipients) for each meeting
5. Prints a per-meeting summary, including a delta against the previous run on the same meeting if one exists
6. Saves a JSON record of the run so future runs can diff

## When to use

Trigger this skill whenever you've made — or are about to verify — a change to `supabase/functions/ai-parse-transcript/index.ts`. Especially:

- Edits to the system prompt (`buildActiveSystemPrompt` / `buildHistoricalSystemPrompt`)
- Changes to the follow-up extraction section, writing rules, or recipient logic
- Changes to action item, commitment, idea, or memory extraction rules
- Changes to the response JSON schema
- Model swaps (Opus / Sonnet / Haiku)
- Changes to `insertExtractedFollowUps` or related insertion helpers

Also trigger when the user says any of:
- "re-parse" / "reparse"
- "test the parser"
- "let me see what the model does now"
- "try it on Storyblok / Sanity / today's meetings / [specific meeting title]"
- "deploy and check"
- "run it again"

The fast feedback loop is the entire point. Do not write ad-hoc curl/JWT/python invocations to do this manually — invoke this skill so the auth, deploy, and output are consistent across iterations.

## How to use

The skill provides one script: `scripts/reparse.py`. Run from the project root.

### Common invocations

**Re-parse specific meetings, with a label describing the change:**
```bash
python3 .claude/skills/resurface-iterate-prompt/scripts/reparse.py \
  --meeting-id 50bb674e-9cd7-48db-936b-7ff86f37b72b \
  --meeting-id 70ffaa02-b8d5-4ba3-ab58-3b6eed4c2165 \
  --label "tighten recipient default"
```

**Re-parse all meetings since a date** (the `--external-only` flag does a light prefilter — the parser itself is still the real judge):
```bash
python3 .claude/skills/resurface-iterate-prompt/scripts/reparse.py \
  --since 2026-04-30 \
  --external-only \
  --label "flip default to generate"
```

**Skip deploy** (testing the same code against a different meeting set, or comparing the previous run's output):
```bash
python3 .claude/skills/resurface-iterate-prompt/scripts/reparse.py \
  --since 2026-04-30 --no-deploy
```

### What the output looks like

For each meeting:
- `meeting_id` and title
- `follow_ups_created` and `proposals_created` counts
- If a follow-up was created: To list, draft_subject, first line of draft_body
- If a prior run on this same meeting exists in history: delta vs that prior run (Δfu, Δprops, prior label + timestamp)

Example:
```
━━━ Orange Logic + EPAM ━━━
  meeting_id: 232642f1-9493-436e-9bb3-134a24189a6c
  follow_ups: 1  proposals: 8
  to: Adam LaPorta
  subject: Good connecting today - next steps on EPAM + Orange Logic
  body[0]: Adam,
  vs prior (20260430T203712, 'tighten recipient default'): Δfu=0 Δprops=+1
```

History records are saved to `.claude/skills/resurface-iterate-prompt/.history/<timestamp>.json` (plain JSON, safe to inspect or delete).

## Why these defaults

- **Deploy by default**: testing a stale function is the most common silent footgun. Skip explicitly with `--no-deploy`.
- **Sequential reparses**: each call is ~20–40s at Opus 4.6. Sequential keeps the output readable and avoids hammering the function. If you need parallelism, ask the user before adding it.
- **Lean inclusive on `--external-only`**: the parser is the real judge of whether a meeting warrants a follow-up. The script's filter just excludes meetings where the only attendee is Dustin (no second party at all). Everything else passes through.
- **One follow-up per meeting pulled in output**: the data model is one shared body per meeting. The script shows the most recent pending follow-up, not historical sent ones.

## Implementation notes

- **Auth**: signs in with `RESURFACE_EMAIL` + `RESURFACE_PASSWORD` from `~/Library/Application Support/Claude/claude_desktop_config.json` under `mcpServers.resurface.env`. No service role key needed; the function accepts user JWTs.
- **Deploy**: invokes `npm run deploy:functions -- ai-parse-transcript`. NOT plain `supabase functions deploy` — the project's deploy script bakes in `--no-verify-jwt`, which the parser requires (it verifies JWTs in code).
- **Project root**: hardcoded to `/Users/dustincollis/resurface`. If the project moves, update the constant at the top of `reparse.py`.
- **Errors**: per-meeting errors don't abort the run; they're reported in the summary and the next meeting continues.

## Extending the skill

If new patterns emerge (e.g., diff against a specific prior run by label, parallel reparses, output the full body not just the first line), add a flag to `reparse.py` rather than writing inline boilerplate again. The skill is the canonical place for this loop.
