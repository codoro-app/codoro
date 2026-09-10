import { Hono } from 'hono'
import { insertReport } from './db'
import { routeLimit } from './limits'
import { VALID_PUZZLE_IDS } from './puzzleIds.generated'
import { rateLimit } from './rateLimit'
import { ReportBodySchema } from './report'
import type { Env } from './env'
import type { ApiErrorResponse, HealthResponse, ReportResponse } from '../shared/api-types'

const app = new Hono<{ Bindings: Env; Variables: { userId?: string } }>()

// The only route in T1 (build plan Phase 5.0 item 1). Unauthenticated by
// nature — a health check that required a token couldn't tell you the
// token verification path itself is broken. `clerkInstance` is F1's
// one-curl diagnostic: it makes a `pk_test_` client pointed at a Worker
// wired for `production` (or vice versa) visible from this one field,
// instead of reading as a mysterious 401 an hour later.
app.get('/api/health', (c) => {
  const body: HealthResponse = {
    ok: true,
    version: c.env.VERSION ?? 'dev',
    clerkInstance: c.env.CLERK_INSTANCE,
  }
  return c.json(body)
})

// T4a: the only anonymous write in the system (unauthenticated by design
// -- guest-first is law and most reporters will not have accounts), so
// it's also the sharpest abuse surface. No free-text field reaches
// storage, in any form: `reason` is a closed enum (Zod + the table's own
// CHECK), `puzzleId` is checked against the real content index
// (VALID_PUZZLE_IDS, generated from src/content/puzzles/**/*.json --
// see puzzleIds.generated.ts's own comment for why this isn't a literal
// import of src/content's module), `appVersion` is stored but never
// interpreted. `rateLimit()` runs before any parsing -- an abusive
// request is rejected on IP alone before this handler spends any work on
// it. routeLimit() throws at startup, not per-request, if 'POST
// /api/report' were ever missing from limits.ts's ROUTE_LIMITS.
app.post(
  '/api/report',
  rateLimit('POST /api/report', routeLimit('POST /api/report')),
  async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json<ApiErrorResponse>({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = ReportBodySchema.safeParse(raw)
    if (!parsed.success) {
      return c.json<ApiErrorResponse>({ error: 'Invalid report body' }, 400)
    }

    if (!VALID_PUZZLE_IDS.has(parsed.data.puzzleId)) {
      return c.json<ApiErrorResponse>({ error: 'Unknown puzzle id' }, 400)
    }

    await insertReport(c.env.DB, {
      puzzleId: parsed.data.puzzleId,
      reason: parsed.data.reason,
      appVersion: parsed.data.appVersion,
      now: Date.now(),
    })

    return c.json<ReportResponse>({ ok: true }, 201)
  },
)

export default app
