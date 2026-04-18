#!/usr/bin/env bash
#
# Deploy Supabase edge functions with --no-verify-jwt baked in.
#
# EVERY function in this repo handles auth in code (AI functions verify
# JWT / service role; webhooks use custom x-*-key headers). Deploying
# without --no-verify-jwt causes the Supabase gateway to 401 anything
# without a valid JWT before the function runs.
#
# Usage:
#   npm run deploy:functions                 # deploy all non-shared functions
#   npm run deploy:functions ai-parse-input  # deploy one or more specific functions
#   npm run deploy:functions a b c           # deploy several

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d "supabase/functions" ]; then
  echo "Error: supabase/functions/ not found — run from repo root." >&2
  exit 1
fi

# If args provided, deploy just those. Otherwise deploy every directory
# under supabase/functions/ that isn't a shared helper.
if [ $# -gt 0 ]; then
  TARGETS=("$@")
else
  TARGETS=()
  for dir in supabase/functions/*/; do
    name="$(basename "$dir")"
    # Skip shared directories (conventionally prefixed with _)
    case "$name" in
      _*) continue ;;
    esac
    TARGETS+=("$name")
  done
fi

if [ ${#TARGETS[@]} -eq 0 ]; then
  echo "No functions to deploy."
  exit 0
fi

echo "Deploying ${#TARGETS[@]} function(s) with --no-verify-jwt:"
for fn in "${TARGETS[@]}"; do
  echo "  - $fn"
done
echo

FAILED=()
for fn in "${TARGETS[@]}"; do
  echo "───────────── $fn ─────────────"
  if ! supabase functions deploy "$fn" --no-verify-jwt; then
    FAILED+=("$fn")
    echo "  ⚠ deploy failed for $fn" >&2
  fi
  echo
done

if [ ${#FAILED[@]} -gt 0 ]; then
  echo "Failed: ${FAILED[*]}" >&2
  exit 1
fi

echo "✓ Deployed ${#TARGETS[@]} function(s)."
