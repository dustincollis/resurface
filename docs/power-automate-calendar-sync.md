# Calendar Sync via Power Automate

Syncs your Outlook calendar to Resurface so you can see upcoming meetings. Uses Power Automate (part of your Microsoft 365 — no third-party app approval needed).

## One-time setup

### 1. Generate an API key

```bash
openssl rand -hex 32
```

### 2. Set the secret in Supabase

```bash
supabase secrets set CALENDAR_SYNC_API_KEY='<paste the key>'
```

(`RESURFACE_DEFAULT_USER_ID` should already be set from the Jamie webhook setup.)

### 3. Deploy the function

```bash
supabase functions deploy calendar-sync --no-verify-jwt
```

### 4. Create the Power Automate flow

Open Power Automate: https://make.powerautomate.com

**Create a new "Scheduled cloud flow":**

- **Name**: Resurface Calendar Sync
- **Run every**: 4 hours (or however often you want — daily is fine too)
- **Start**: now

**Step 1 — Get calendar events:**
- Add action: **"Get calendar view of events (V3)"** (Office 365 Outlook connector)
- Calendar: your default calendar
- Start time: `utcNow()`
- End time: `addDays(utcNow(), 7)` (next 7 days)

**Step 2 — Send to Resurface:**
- Add action: **"HTTP"**
- Method: **POST**
- URI: `https://biapwycemhtdhcpmgshp.supabase.co/functions/v1/calendar-sync`
- Headers:
  - `Content-Type`: `application/json`
  - `x-calendar-sync-key`: `<the API key from step 1>`
- Body: select the **"value"** output from step 1 (this is the array of events)

**Save and test:**
- Click "Test" → "Manually" → Run
- Check Resurface's `/meetings` page — you should see upcoming meetings appear with source badge "calendar_sync"

### 5. Verify

After the first run, your meetings page should show the next 7 days of calendar events. Each event becomes a meeting row with:
- `source = 'calendar_sync'`
- `external_source_id = 'outlook:event:<event_id>'`
- Title, start/end times, attendees, location populated from Outlook
- `import_mode = 'active'`
- No transcript (these are future meetings — transcripts come later via Jamie when the meeting actually happens)

### How updates work

- **Rescheduled meetings**: Power Automate re-sends the event with the same ID on the next sync → the function updates the title/time/attendees instead of creating a duplicate.
- **Cancelled meetings**: events with `isCancelled: true` are skipped.
- **All-day events**: skipped (these are typically OOO/holidays, not meetings).
- **New meetings**: added to the calendar after the last sync are picked up on the next run.

### What this gives you in Resurface

- Upcoming meetings visible on `/meetings` with attendees and times
- Pre-meeting context: when you open a future meeting, you can see the attendees and any existing items/commitments/pursuits linked to those people
- When Jamie fires the webhook after the meeting actually happens, the transcript fills into the existing meeting row (matched by time/title) or creates a new row alongside it

### Cost

Power Automate's free tier includes 750 runs/month. At 6 runs/day (every 4 hours), that's ~180 runs/month — well within limits.

### Troubleshooting

- **401 Unauthorized**: API key mismatch. Check `CALENDAR_SYNC_API_KEY` in Supabase secrets vs. the Power Automate HTTP header.
- **No events showing up**: check the Power Automate run history for errors. The "Get calendar view" action might need you to authorize the Office 365 connector first (it'll prompt on first use).
- **Duplicate meetings**: shouldn't happen — the function deduplicates by `outlook:event:<id>`. If you see dupes, the event ID format might be different than expected — check the function logs.
