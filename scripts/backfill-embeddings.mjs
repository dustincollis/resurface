const supabaseUrl =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  'https://biapwycemhtdhcpmgshp.supabase.co'

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SB_SERVICE_ROLE_KEY

if (!serviceRoleKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY or SB_SERVICE_ROLE_KEY is required')
  process.exit(1)
}

const maxRuns = Number.parseInt(process.argv[2] ?? '50', 10)
let total = 0

for (let run = 1; run <= maxRuns; run += 1) {
  const response = await fetch(`${supabaseUrl}/functions/v1/embed-corpus`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
    body: JSON.stringify({ mode: 'backfill' }),
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error(`Backfill run ${run} failed (${response.status})`, body)
    process.exit(1)
  }

  const embedded = Number(body.embedded ?? 0)
  total += embedded
  console.log(`Run ${run}: embedded ${embedded}`, body.counts ?? {})

  if (embedded === 0) break
}

console.log(`Done. Embedded ${total} rows.`)
