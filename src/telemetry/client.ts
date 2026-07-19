/**
 * Internal PostHog wiring — implementation detail of the telemetry choke
 * point, not part of the public barrel (see ./index.ts).
 *
 * `initTelemetry` configures the posthog-js singleton from env.ts.
 * `safeCapture` is the *only* call site for `posthog.capture()` in this
 * codebase — every track* function in events.ts routes through it.
 *
 * Both gate on `env.VITE_POSTHOG_KEY` being present before touching
 * posthog-js at all, and both wrap the underlying call in try/catch: a
 * missing key (local dev) or a blocked/misbehaving PostHog script (an
 * ad-blocker, a throwing `init()`/`capture()`) must never throw out of this
 * module and never break the app or an attempt flow.
 *
 * We never call `posthog.identify()` anywhere in this module — every user
 * stays on PostHog's own default anonymous `distinct_id`. `person_profiles:
 * 'identified_only'` tells PostHog not to create a person profile for
 * anonymous events either, since we'll never identify anyone to attach one
 * to.
 */
import posthog from 'posthog-js'
import { env } from '../env'

export function initTelemetry(): void {
  if (!env.VITE_POSTHOG_KEY) {
    return
  }
  try {
    posthog.init(env.VITE_POSTHOG_KEY, {
      api_host: env.VITE_POSTHOG_HOST,
      person_profiles: 'identified_only',
    })
  } catch {
    // A blocked/misconfigured analytics provider must never break the app.
  }
}

export function safeCapture(event: string, properties?: object): void {
  if (!env.VITE_POSTHOG_KEY) {
    return
  }
  try {
    posthog.capture(event, properties)
  } catch {
    // A blocked/misconfigured analytics provider must never break the app.
  }
}
