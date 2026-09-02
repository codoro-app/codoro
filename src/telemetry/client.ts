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
 * to. That decision is unchanged by `registerAnonId` below (Phase 7 Item
 * 6): it calls `posthog.register()`, not `identify()` — a *super property*
 * (an app-generated, PII-free ID from the profile store) automatically
 * attached to every event captured after registration, not a change of
 * `distinct_id` and not a merge of any two identities. Chosen deliberately
 * over `identify()` for two reasons, in order: (1) `identify()` creates a
 * PostHog person profile, which this app's `person_profiles:
 * 'identified_only'` setting and pricing model treat differently from an
 * anonymous event — registering a super property creates no person profile
 * at all, so this stays free of that cost question entirely rather than
 * requiring one to be answered; (2) `identify()`'s first call on a given
 * `distinct_id` *merges* that browser's whole prior anonymous history into
 * whatever person it's identified as — exactly the wrong shape for Item
 * 6's import collision (a player importing a friend's export file must
 * never cause PostHog to treat the two of them as one person). A
 * registered super property has no merge semantics: re-registering it
 * after an import just changes what value future events carry, with zero
 * retroactive effect. See `src/storage/exportImport.ts`'s `commitImport`
 * for the other half of that decision (the imported file's own `anonId` is
 * never applied to this device). Retention analysis must key off this
 * property directly (e.g. a custom insight grouping by
 * `properties.codoro_anon_id`) rather than PostHog's stock person-based
 * Retention insight, since no person is ever created — unverified against
 * the live PostHog project in this environment; see
 * docs/v2-build-plan.md's Phase 7 amendment.
 *
 * posthog-js's *default* init also turns on autocapture, session recording,
 * surveys, dead-click detection, and web-vitals capture — none of which are
 * part of the locked schema (see README.md) or the "anonymous ID only, no
 * PII" requirement: session recording in particular replays on-screen
 * content, well outside what this app deliberately chose to collect. Each
 * is explicitly disabled below, plus `disable_external_dependency_loading`
 * (the documented blanket switch — see posthog-js's own
 * `PostHogConfig['disable_external_dependency_loading']` doc comment) as a
 * belt-and-suspenders guard against any of their lazy-loaded scripts
 * (recorder.js, surveys.js, dead-clicks-autocapture.js, web-vitals.js)
 * shipping at all, present or future, so this module really is the single
 * choke point for what gets collected, not just for the events we happen
 * to call `safeCapture` for.
 *
 * Pageview tracking ("site-flow funnel" follow-up) is deliberately
 * hand-rolled rather than posthog-js's own automatic `capture_pageview`/
 * history-change watcher: `events.ts`'s `trackPageview()` is called from the
 * exact same "once per distinct route, including the first render" trigger
 * `useRouteTelemetry.ts` already uses for `route_view`, so there's one
 * dedupe mechanism to trust instead of two. `capture_pageleave: true` below
 * IS posthog-js's own automatic behavior — unlike pageview, exit detection
 * is a real browser-lifecycle signal (`beforeunload`/`visibilitychange`)
 * with no app-routing awareness needed, so there's nothing to hand-roll
 * there.
 *
 * `before_send` closes a gap the rest of this file doesn't: posthog-js
 * attaches `$current_url`/`$pathname` to *every* captured event (unrelated
 * to `capture_pageview`/autocapture — it's unconditional default event
 * enrichment) as the full, real `window.location.href`. Without this hook,
 * a `/puzzle/<real-id>` or `/challenge?<payload>` visit would leak exactly
 * the raw id/payload data that `route_view`'s own `route` property already
 * goes out of its way to scrub (routes.ts's `routePatternForPath`) — just
 * through a different property on the same event. `initTelemetry`'s
 * `sanitizePathname` parameter (always `routePatternForPath` in production,
 * see main.tsx) is run over `$pathname` and over `$current_url`'s own path
 * component; `$current_url`'s query string and hash are stripped
 * unconditionally regardless of the sanitizer, since neither this file nor
 * its caller can know in general which query params/hashes are
 * PII-carrying and which aren't (the one exception, Codoro's own
 * `utm_*`/referrer values, is already handled by `trackSessionStart`'s
 * `currentSessionAttribution`, which reads them directly rather than
 * relying on `$current_url`). Applied to every event, not just
 * pageviews — `$current_url`/`$pathname` ride along on `session_start`,
 * `attempt`, etc. too, so the fix has to live at this single choke point,
 * not in `trackPageview` alone. (`before_send`, not the older
 * `sanitize_properties` — posthog-js's own types mark that one deprecated
 * in favor of this.)
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
import type { CaptureResult as PostHogCaptureResult } from 'posthog-js'

type PostHogInstance = typeof import('posthog-js').default

let posthogPromise: Promise<PostHogInstance> | null = null

// Perf pass (2026-08-24): the underlying import('posthog-js') fetch+parse
// (~220 KB raw / 72 KB transferred, confirmed via a real production
// Lighthouse run) used to start the instant loadPosthog() was first
// called — which was main.tsx's initTelemetry()/trackSessionStart() at
// boot, competing for bandwidth and main thread with the app's own chunks
// right inside the LCP window. Scheduling the *import itself* onto the
// browser's idle period (falling back to a macrotask where
// requestIdleCallback doesn't exist — Safari has none) moves that fetch out
// of the critical path without changing when callers THINK the module is
// ready: posthogPromise is still created and memoized exactly once, on
// first call, so every caller (however many, however soon after each
// other) still awaits the same single promise and queues correctly even if
// they call in before the idle callback has fired — no event is dropped,
// it's just captured a little later than it used to be.
function scheduleIdle(run: () => void): void {
  const idle: (cb: () => void) => void =
    typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
      ? (cb) => {
          window.requestIdleCallback(cb)
        }
      : (cb) => {
          setTimeout(cb, 0)
        }
  idle(run)
}

function loadPosthog(): Promise<PostHogInstance> | null {
  if (!env.VITE_POSTHOG_KEY) {
    return null
  }
  posthogPromise ??= new Promise<PostHogInstance>((resolve, reject) => {
    scheduleIdle(() => {
      import('posthog-js')
        .then((mod) => {
          resolve(mod.default)
        })
        .catch((error: unknown) => {
          reject(error instanceof Error ? error : new Error(String(error)))
        })
    })
  })
  return posthogPromise
}

/**
 * Strips PII-carrying data out of the `$current_url`/`$pathname` properties
 * posthog-js attaches to every event by default — see this file's own top
 * doc comment for why that's necessary at all. `sanitizePathname` is run
 * over both `$pathname` and `$current_url`'s path component; identity
 * (pathname unchanged) when the caller doesn't supply one, so a stray
 * direct call to `initTelemetry()` — every existing test call site, and any
 * future one — still gets query-string/hash stripping rather than silently
 * losing sanitization altogether. `capture` (posthog-js's `CaptureResult`)
 * can itself be `null` (another plugin in the `before_send` chain already
 * dropped the event) — passed straight through, nothing to sanitize.
 */
function sanitizeCaptureResult(
  sanitizePathname: (pathname: string) => string,
): (capture: PostHogCaptureResult | null) => PostHogCaptureResult | null {
  return (capture) => {
    if (!capture) {
      return capture
    }
    const properties: Record<string, unknown> = { ...capture.properties }
    if (typeof properties.$pathname === 'string') {
      properties.$pathname = sanitizePathname(properties.$pathname)
    }
    if (typeof properties.$current_url === 'string') {
      try {
        const url = new URL(properties.$current_url)
        url.search = ''
        url.hash = ''
        url.pathname = sanitizePathname(url.pathname)
        properties.$current_url = url.toString()
      } catch {
        // Not a parseable URL — drop it rather than risk forwarding an
        // unsanitized value we can't reason about.
        delete properties.$current_url
      }
    }
    return { ...capture, properties }
  }
}

/**
 * `sanitizePathname` maps a real pathname to a PII-free pattern — in
 * production, main.tsx always passes routes.ts's `routePatternForPath`
 * (never imported directly by this file: telemetry/ stays independent of
 * app/, same layering as every other choke-point module in this codebase —
 * see events.ts/README.md). Defaults to identity (see
 * `sanitizeEventProperties`'s own doc comment) so every pre-existing call
 * site (`initTelemetry()`, no argument) keeps compiling and keeps getting
 * query-string/hash stripping even without a real pattern-matcher supplied.
 */
export function initTelemetry(sanitizePathname: (pathname: string) => string = (p) => p): void {
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
        capture_pageleave: true,
        disable_session_recording: true,
        capture_dead_clicks: false,
        capture_performance: false,
        disable_surveys: true,
        disable_external_dependency_loading: true,
        before_send: sanitizeCaptureResult(sanitizePathname),
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

/**
 * Registers the stable anonymous ID (src/storage's UserProfile.anonId) as a
 * super property — see this file's own top doc comment for the full
 * mechanism decision. Called once per app session, from main.tsx, after the
 * profile loads (a `loadProfile()` read, not blocking `initTelemetry`/
 * `trackSessionStart` — see main.tsx's own comment on the resulting race:
 * `session_start` itself may rarely fire before this resolves, but every
 * event after profile load carries it). Idempotent and side-effect-free if
 * called more than once with the same value, same as posthog-js's own
 * `register()`.
 */
export function registerAnonId(anonId: string): void {
  const posthog = loadPosthog()
  if (!posthog) {
    return
  }
  posthog
    .then((ph) => {
      ph.register({ codoro_anon_id: anonId })
    })
    .catch(() => {
      // A blocked/misconfigured analytics provider must never break the app.
    })
}
