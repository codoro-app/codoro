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
 *
 * posthog-js's *default* init also turns on autocapture, pageview tracking,
 * session recording, surveys, dead-click detection, and web-vitals capture
 * — none of which are part of the locked schema (session_start/attempt/
 * app_error only, see README.md) or the "anonymous ID only, no PII"
 * requirement: session recording in particular replays on-screen content,
 * well outside what this app deliberately chose to collect. Each is
 * explicitly disabled below, plus `disable_external_dependency_loading`
 * (the documented blanket switch — see posthog-js's own
 * `PostHogConfig['disable_external_dependency_loading']` doc comment) as a
 * belt-and-suspenders guard against any of their lazy-loaded scripts
 * (recorder.js, surveys.js, dead-clicks-autocapture.js, web-vitals.js)
 * shipping at all, present or future, so this module really is the single
 * choke point for what gets collected, not just for the events we happen
 * to call `safeCapture` for.
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
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      capture_dead_clicks: false,
      capture_performance: false,
      disable_surveys: true,
      disable_external_dependency_loading: true,
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
