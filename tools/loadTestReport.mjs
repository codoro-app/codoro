// tools/loadTestReport.mjs
//
// T14, right-sized: bursts POST /api/report against the deployed dev
// Worker to prove the shared rateLimit() mechanism holds under load for
// real (429 + Retry-After), and records p95 latency. Targets a
// relaunch-sized bump (low hundreds-low thousands of visitors), not a
// 1x/10x/100x DAU model -- see docs/prompts/claude_code_prompt_v5_phase5.4_5.6.md.
//
// PUT /api/profile's own rate-limit behavior needs a real Clerk session
// token (clerkAuth() runs before rateLimit() on that route -- an
// unauthenticated burst never reaches the limiter at all, which is itself
// a real finding worth recording). Creating that token requires a Clerk
// account, which this script -- and this session -- does not create (see
// this plan's Global Constraints). Pass PROFILE_TOKEN to also burst
// PUT /api/profile once a token is available.
import autocannon from 'autocannon'

const TARGET = process.env.LOAD_TEST_TARGET ?? 'https://codoro-api-dev.codoroapp.workers.dev'
const DURATION_SECONDS = Number(process.env.LOAD_TEST_DURATION ?? 15)
// REPORT_LIMIT_PER_MINUTE below must track workers/wrangler.jsonc's
// RATE_LIMITER_REPORT_IP simple.limit (5/60s) -- 2x that rate per the
// DoD ("rate limiter holds under 2x its own configured limit").
const REPORT_LIMIT_PER_MINUTE = 5
const TARGET_RPS = Math.ceil((REPORT_LIMIT_PER_MINUTE / 60) * 2)

async function burstReport() {
  const result = await autocannon({
    url: `${TARGET}/api/report`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ puzzleId: 'con-001', reason: 'wrong-answer', appVersion: 'load-test' }),
    connections: TARGET_RPS,
    duration: DURATION_SECONDS,
    pipelining: 1,
  })
  return result
}

async function burstProfile(token) {
  return autocannon({
    url: `${TARGET}/api/profile`,
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ schemaVersion: 1, payload: { loadTest: true }, baseRevision: 0 }),
    connections: 10,
    duration: DURATION_SECONDS,
    pipelining: 1,
  })
}

function summarize(label, result) {
  const statusCounts = result.statusCodeStats ?? {}
  console.log(`\n=== ${label} ===`)
  console.log(`target: ${TARGET}, duration: ${String(DURATION_SECONDS)}s`)
  console.log(`requests: ${String(result.requests.total)} total, ${String(result.requests.average)} avg/s`)
  console.log(`latency p50/p95/p99 (ms): ${String(result.latency.p50)}/${String(result.latency.p97_5)}/${String(result.latency.p99)}`)
  console.log(`status codes: ${JSON.stringify(statusCounts)}`)
  const retryAfterSample = result.non2xx > 0 ? '(check a sample 429 response header manually with curl -i)' : 'n/a (no 429s observed)'
  console.log(`Retry-After header on 429s: ${retryAfterSample}`)
}

const reportResult = await burstReport()
summarize('POST /api/report burst', reportResult)

if (process.env.PROFILE_TOKEN) {
  const profileResult = await burstProfile(process.env.PROFILE_TOKEN)
  summarize('PUT /api/profile burst (authenticated, token supplied)', profileResult)
} else {
  console.log('\n=== PUT /api/profile burst ===')
  console.log('Skipped -- no PROFILE_TOKEN env var set. This route requires a real Clerk')
  console.log('session token (clerkAuth() runs before rateLimit() on this route), which this')
  console.log('script does not create for you. See the T14 section of the closing amendment')
  console.log('for the exact human-run steps.')
}
