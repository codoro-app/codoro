import { Hono } from 'hono'
import { clerkAuth } from './auth'
import { deleteClerkUser } from './clerkAdmin'
import { deleteUser, insertReport } from './db'
import { routeLimit } from './limits'
import { VALID_PUZZLE_IDS } from './puzzleIds.generated'
import { rateLimit } from './rateLimit'
import { ReportBodySchema } from './report'
import type { AuthVariables } from './auth'
import type { Env } from './env'
import type { ApiErrorResponse, HealthResponse, ReportResponse } from '../shared/api-types'

const app = new Hono<{ Bindings: Env; Variables: Partial<AuthVariables> }>()

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

// T5: the one place this Worker's client-auth phase touches `workers/` —
// everything else in T5 is client-side (see the implementation plan's own
// note). Deletes the D1 `users` row (cascades to profiles/scores/
// scores_best/email_prefs via ON DELETE CASCADE, migration 0001) and the
// Clerk user via the Admin API (clerkAdmin.ts). **Idempotent**, per the API
// contract: a second call for an already-deleted user still returns 204 —
// `deleteUser()`'s DELETE matches zero rows silently, and
// `deleteClerkUser()` treats Clerk's 404 as already-done, not an error.
// Confirming the deletion actually happened (re-querying D1 + the Clerk
// Admin API afterward) is the client's own DoD step and T13's full sweep,
// not this handler's job — this handler's contract is just "the delete
// call itself doesn't lie about succeeding."
app.delete(
  '/api/account',
  clerkAuth(),
  rateLimit('DELETE /api/account', routeLimit('DELETE /api/account')),
  async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      // Unreachable in practice — clerkAuth() above already 401s before
      // this handler runs — but c.get('userId') types as `string |
      // undefined` (Variables is Partial<AuthVariables> at the app level,
      // see this file's own Hono<> declaration), so this satisfies the
      // compiler without an unsafe assertion.
      return c.json<ApiErrorResponse>({ error: 'Unauthorized' }, 401)
    }
    await deleteUser(c.env.DB, userId)
    await deleteClerkUser(c.env.CLERK_SECRET_KEY, userId)
    return c.body(null, 204)
  },
)

export default app
