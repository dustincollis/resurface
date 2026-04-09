# Jamie Webhook Setup

The `jamie-webhook` edge function receives `meeting.completed` events from Jamie (meetjamie.ai) and ingests them automatically into Resurface — no manual paste step. Each meeting:

1. Is inserted into the `meetings` table with `source = 'jamie_webhook'` and `external_source_id = 'jamie:meeting:<id>'` for dedup
2. Is parsed by `ai-parse-transcript` (server-to-server, via service role)
3. Produces task and commitment proposals attributed to real speaker names (because Jamie pre-attributes the transcript)

## One-time setup

### 1. Generate a strong API key

```bash
openssl rand -hex 32
```

Copy the output. This is the shared secret between Jamie and Resurface.

### 2. Find your Resurface user ID

In the Supabase SQL editor:
```sql
select id, display_name from profiles where id = auth.uid();
```
(or just open the `profiles` table and copy the row's id)

### 3. Set the secrets in Supabase

Both must be set as Edge Function secrets so the function can read them at runtime:

```bash
supabase secrets set JAMIE_WEBHOOK_API_KEY='<paste from step 1>'
supabase secrets set RESURFACE_DEFAULT_USER_ID='<paste from step 2>'
```

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase — no need to set them.)

### 4. Deploy the function

```bash
supabase functions deploy jamie-webhook --no-verify-jwt
```

The `--no-verify-jwt` flag is critical. Jamie won't have a Supabase JWT — the function does its own auth via the API key header.

### 5. Configure the webhook in Jamie

In Jamie's webhook settings:

- **URL**: `https://biapwycemhtdhcpmgshp.supabase.co/functions/v1/jamie-webhook`
- **Auth header**: `x-jamie-api-key`
- **Auth value**: the API key from step 1
- **Events**: subscribe to `meeting.completed`

Save. Jamie should send a test ping or you can trigger one from their UI.

## Verifying it works

After completing a meeting in Jamie, you should see:

1. A new row in `meetings` with `source = 'jamie_webhook'`, populated `transcript`, and the speaker names in `attendees`
2. New rows in `proposals` (task type) and possibly `commitments` (commitment type) attributed to specific speakers
3. The Supabase function logs for `jamie-webhook` should show the call succeeded

If the function logs show `[jamie-webhook] first segment keys: [...]`, that's a one-shot diagnostic confirming what field names Jamie's transcript entries actually use. If the field names don't match what `pickText` and `pickStartMs` look for, the formatted transcript will be empty — adjust those helper functions in the function source.

## Troubleshooting

**401 Unauthorized**: API key mismatch. Re-check `JAMIE_WEBHOOK_API_KEY` in Supabase secrets vs. what Jamie is sending.

**500 "Server misconfigured"**: One of `JAMIE_WEBHOOK_API_KEY` or `RESURFACE_DEFAULT_USER_ID` isn't set. Run the `supabase secrets set` commands again and re-deploy.

**Duplicate meetings**: The `(user_id, external_source_id)` unique index prevents this. If Jamie retries after a transient failure, the second call returns `200 OK` with `duplicate: true` and Jamie stops retrying.

**"Meeting created but parser failed"**: The meeting row is in the DB but `ai-parse-transcript` errored. The webhook returns 200 to Jamie (don't want it retrying — would just hit the dedup check). To re-trigger parsing manually:

```bash
curl -X POST "https://biapwycemhtdhcpmgshp.supabase.co/functions/v1/ai-parse-transcript" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"meeting_id":"<the meeting uuid>","transcript":"<paste the transcript>"}'
```

**Empty transcript warning**: Function logs say "empty transcript, nothing ingested". Either Jamie sent a malformed payload or the transcript field isn't where the function expects. Check the function logs for `first segment keys` to see what Jamie actually sent, and adjust the `pickText` / `pickStartMs` helpers if needed.

## Field-name defensiveness

The function tries multiple common field names because the Jamie webhook spec we have only shows partial structure:

- **Speaker text** is looked up in: `text` → `content` → `sentence` → `transcript` → `body`
- **Start time** is looked up in: `startTime` → `beginTime` → `start_time` → `begin_time` → `timestamp` → `ts` → `start`
- **Speaker name** is looked up in: `speakerName` → `speaker` → falls back to `Speaker <speakerId>`

If real Jamie payloads use a different field name, the function logs the first segment's keys on every webhook call so we can spot it and fix the helpers.

## What stays the same

- Manual paste / file upload paths in the UI continue to work (HiNotes legacy + ad-hoc imports)
- Active/archive modes still apply, though webhook ingestion is always `active`
- `ai-parse-transcript` is unchanged — Jamie content goes through the same pipeline as everything else
- Proposals queue, commitments, pursuits all work identically downstream
