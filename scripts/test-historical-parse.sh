#!/bin/bash
# Test the historical parser on a single meeting.
# Usage: SB_KEY=your_service_role_key ./scripts/test-historical-parse.sh

if [ -z "$SB_KEY" ]; then
  echo "Usage: SB_KEY=your_service_role_key ./scripts/test-historical-parse.sh"
  exit 1
fi

MEETING_ID="fdc83b97-157c-44f1-9e24-ce4c7da4127b"
URL="https://biapwycemhtdhcpmgshp.supabase.co/functions/v1/ai-parse-transcript"

echo "Parsing meeting: $MEETING_ID"
echo "Title: 2026-04-10 Review of Adobe Migration Proposal and Strategic Planning"
echo "Transcript length: ~20k chars"
echo ""

curl -s -X POST "$URL" \
  -H "Authorization: Bearer $SB_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"meeting_id\": \"$MEETING_ID\", \"mode\": \"historical\"}" | python3 -m json.tool
