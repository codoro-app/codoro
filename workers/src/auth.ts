import { verifyToken } from '@clerk/backend'
import type { Context, MiddlewareHandler, Next } from 'hono'
import type { Env } from './env'

/**
 * Hono context variables the auth middleware attaches. Every route that
 * mounts `clerkAuth()` gets `Variables: AuthVariables` in its generic
 * parameters so `c.get('userId')` typechecks.
 */
export interface AuthVariables {
  userId: string
}

type AuthedContext = Context<{ Bindings: Env; Variables: AuthVariables }>

/**
 * T3: Clerk session-token verification, networkless via the pinned
 * CLERK_JWT_KEY (the Development/Production instance's JWKS public key,
 * Task 0). This is the ONLY place a token is ever read in this Worker
 * (T3's DoD) — every other module reaches the authenticated user id via
 * `c.get('userId')`, never by parsing a header itself.
 *
 * Bearer-only, deliberately (F3): the same-origin `/api/*` route makes
 * Clerk's `__session` cookie reachable on every request, but reading it
 * would make every endpoint CSRF-able — the browser attaches a cookie
 * whether or not this code asked for it. `Authorization: Bearer <token>`
 * requires the client to have explicitly attached it.
 *
 * F7: the plan's 2026-08-26 note claimed Core 3 consolidates
 * verifyToken()/verifyAccessToken()/verifySecret() into a single verify().
 * That does not match what's actually installed — @clerk/backend 3.17.2's
 * package root exports `verifyToken(token, options)` and no `verify` at
 * all (checked directly against the installed package's dist/index.d.ts,
 * not assumed from the plan). verifyToken() throws on any invalid token
 * (expired, forged signature, wrong audience/authorizedParties, malformed)
 * — every failure mode collapses to one generic 401 below, since
 * distinguishing them in the response body only helps an attacker iterate.
 *
 * Clock skew (F4) is left at @clerk/backend's default (`clockSkewInMs`,
 * 5000ms) — not passed here at all. Clerk session tokens are short-lived by
 * design; if intermittent 401s ever show up in the field, the fix is the
 * client's `getToken()`-per-request pattern (T5's `src/auth/api.ts`), not
 * widening this tolerance. Widening it just extends how long a leaked
 * token stays usable.
 */
export function clerkAuth(): MiddlewareHandler<{ Bindings: Env; Variables: AuthVariables }> {
  return async (c, next: Next) => {
    const header = c.req.header('Authorization')
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    try {
      const claims = await verifyToken(token, {
        jwtKey: c.env.CLERK_JWT_KEY,
        authorizedParties: [c.env.APP_ORIGIN],
      })
      c.set('userId', claims.sub)
    } catch {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    await next()
  }
}

/**
 * I5's authorization helper — deliberately separate from clerkAuth() above.
 * Authentication answers "who is this"; this is the only thing in the
 * Worker that answers "may they do this" for a specific resource. Route
 * handlers that own a per-user row (T7's profiles, T9's username, T10's
 * scores, ...) call this with that row's actual `clerk_user_id` once those
 * routes exist — nothing here reads a role, capability, or flag from the
 * request body (I9); the only input is the authenticated id and the
 * resource's real owner id.
 *
 * Returns a 403 Response to return directly from the caller's handler, or
 * `null` when the check passes (call site: `const denied =
 * requireOwnership(c, row.clerk_user_id); if (denied) return denied`).
 */
export function requireOwnership(c: AuthedContext, ownerId: string): Response | null {
  if (c.get('userId') !== ownerId) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  return null
}
