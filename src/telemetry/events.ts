/**
 * Event definitions — the locked longitudinal analytics schema shared by
 * Practice now and Daily/Rush later. Field names are exact and
 * non-negotiable (snake_case, matching PostHog's own convention for event
 * properties) — do not rename, camelCase, or restructure them. See
 * src/telemetry/README.md.
 */
import type { AttemptMode } from '../engine'
import type { Puzzle } from '../content'
import { safeCapture } from './client'

// Error events aren't part of the locked schema above, but we still bound
// their size deliberately: an error message/stack can in unusual cases
// carry user-typed content, and we never want to ship an unbounded
// serialized blob to an analytics provider.
const MAX_ERROR_MESSAGE_LENGTH = 500
const MAX_ERROR_STACK_LENGTH = 2000

/** Exact `attempt` event property shape — see the schema lock in the README. */
export interface AttemptEventPayload {
  puzzle_id: string
  correct: boolean
  time_ms: number
  mode: AttemptMode
  interaction: Puzzle['interaction']
  user_rating_before: number
  user_rating_after: number
}

/** Fired once per app session (e.g. once on initial app mount). */
export function trackSessionStart(): void {
  safeCapture('session_start')
}

/** Fired once per puzzle attempt. Property names are locked — see the module doc above. */
export function trackAttempt(payload: AttemptEventPayload): void {
  safeCapture('attempt', payload)
}

/**
 * Lightweight error-tracking event, not part of the locked schema above —
 * this is our call for V1: PostHog's own error capture is enough for now,
 * we're not pulling in Sentry (see the PR description for the reasoning).
 * Truncated message + stack only, no PII, no arbitrary object dumps.
 */
export function trackError(error: unknown, context?: string): void {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined

  safeCapture('app_error', {
    message: message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
    stack: stack?.slice(0, MAX_ERROR_STACK_LENGTH),
    context,
  })
}
