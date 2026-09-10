import { Hono } from 'hono'
import type { Env } from './env'
import type { HealthResponse } from '../shared/api-types'

const app = new Hono<{ Bindings: Env }>()

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

export default app
