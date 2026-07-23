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
 *
 * `posthog-js` itself is loaded via a dynamic `import()`, not a static
 * top-of-file import — this is the one thing in the whole codebase that
 * genuinely doesn't need to be in the initial bundle: nothing on the first
 * paint path depends on analytics, so there's no reason to ship and parse
 * posthog-js before the app is visible. `loadPosthog()` memoizes the
 * import() promise so init/capture calls (however many, however soon after
 * each other) only ever trigger one network fetch, and every call site
 * below keeps its original synchronous-looking void signature — nothing
 * outside this file changes.
 */
import { env } from '../env'

type PostHogInstance = typeof import('posthog-js').default

let posthogPromise: Promise<PostHogInstance> | null = null

function loadPosthog(): Promise<PostHogInstance> | null {
  if (!env.VITE_POSTHOG_KEY) {
    return null
  }
  posthogPromise ??= import('posthog-js').then((mod) => mod.default)
  return posthogPromise
}

export function initTelemetry(): void {
  const key = env.VITE_POSTHOG_KEY
  const posthog = loadPosthog()
  if (!posthog || !key) {
    return
  }
  posthog
    .then((ph) => {
      ph.init(key, {
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
    })
    .catch(() => {
      // A blocked/misconfigured analytics provider must never break the app.
    })
}

export function safeCapture(event: string, properties?: object): void {
  const posthog = loadPosthog()
  if (!posthog) {
    return
  }
  posthog
    .then((ph) => {
      ph.capture(event, properties)
    })
    .catch(() => {
      // A blocked/misconfigured analytics provider must never break the app.
    })
}
