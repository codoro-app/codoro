/**
 * T5: the ONE fetch wrapper every `/api/*` call goes through — token
 * attach, timeouts, and one error taxonomy every caller shares. Nothing
 * else in this app calls `fetch` against `/api/*` directly (the build
 * prompt's own rule for this file).
 *
 * Token attach is per-call, not cached: `getToken()` is passed in by the
 * caller (via `useAuthToken()`, src/auth/useAuthToken.ts) and re-fetched
 * fresh for every request rather than read once and reused — the same F4
 * discipline auth.ts's own doc comment names ("getToken() per request...
 * nobody else calls the API; skew stays at the default"). I10 holds here
 * too: the token returned by `getToken()` is used exactly once, in this
 * function's own memory, and never written to any storage.
 */
import type { ApiErrorResponse } from 'workers/shared/api-types'

const DEFAULT_TIMEOUT_MS = 10_000

export type ApiErrorKind =
  | 'network' // fetch itself rejected (offline, DNS, CORS -- never expected same-origin)
  | 'timeout' // AbortController fired before a response arrived
  | 'unauthorized' // 401 -- no/expired/invalid token
  | 'forbidden' // 403 -- valid token, not allowed
  | 'not-found' // 404
  | 'rate-limited' // 429
  | 'server' // 5xx
  | 'invalid-response' // 2xx but the body wasn't the JSON shape expected
  | 'client' // any other 4xx

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number

  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    if (status !== undefined) this.status = status
  }
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'server'
  return 'client'
}

async function errorMessageFrom(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ApiErrorResponse
    if (typeof body.error === 'string' && body.error.length > 0) return body.error
  } catch {
    // Body wasn't JSON, or wasn't the { error } shape -- fall through to
    // the generic message below rather than surfacing a parse error.
  }
  return `Request failed (${String(res.status)})`
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /**
   * Pass `null`/`undefined` for signed-out calls (e.g. POST /api/report,
   * which is unauthenticated by design) -- no Authorization header is sent
   * in that case, not an empty/placeholder one.
   */
  token?: string | null
  body?: unknown
  timeoutMs?: number
}

/**
 * Fetches `path` against the same-origin `/api/*` surface (see
 * docs/superpowers/plans/2026-08-27-v5-accounts-implementation-plan.md's
 * architecture note: no CORS, ever, on this route). Returns the parsed JSON
 * body on 2xx, or throws `ApiError` with a taxonomy every caller can branch
 * on without re-deriving it from a raw status code.
 *
 * `T` is trusted, not validated -- the same convention profileStore.ts's
 * own callers use server-side (the wire contract is `workers/shared/
 * api-types.ts`, not re-verified with a runtime schema on this side. A
 * caller that needs a `204 No Content` response passes `T = void`.
 */
export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', token, body, timeoutMs = DEFAULT_TIMEOUT_MS } = options

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('timeout', 'Request timed out.')
    }
    throw new ApiError('network', 'Could not reach the server.')
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    throw new ApiError(kindForStatus(res.status), await errorMessageFrom(res), res.status)
  }

  if (res.status === 204) {
    return undefined as T
  }

  try {
    return (await res.json()) as T
  } catch {
    throw new ApiError('invalid-response', 'The server returned an unexpected response.')
  }
}
