import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './app/App'
import { env } from './env'
import {
  identifyUser,
  initTelemetry,
  registerAnonId,
  trackError,
  trackSessionStart,
} from './telemetry'
import { routePatternForPath } from './app/routes'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found in index.html')
}

// routePatternForPath is passed in (rather than telemetry/ importing it
// itself) to keep telemetry/ independent of app/ — same layering as every
// other choke-point module in this codebase. It's what sanitizes the
// $current_url/$pathname PostHog attaches to every event; see
// telemetry/client.ts's own doc comment.
initTelemetry(routePatternForPath)
trackSessionStart()
// Dev-only identity fallback: Thomas is the only person who ever runs
// `pnpm dev` locally, so a set VITE_DEV_IDENTITY_USER_ID identifies this
// local server's own traffic as one known person even before any Clerk
// sign-in, instead of leaving it anonymous. The literal `import.meta.env.DEV`
// check must stay inline here (not a wrapper re-exported from telemetry/) --
// Vite's static analysis needs to see this exact condition at the call site
// to dead-code-eliminate the whole branch from a production build; see
// src/env.ts's own comment on VITE_DEV_IDENTITY_USER_ID. A real Clerk
// sign-in during a dev session still takes precedence -- this only covers
// the guest state, and SyncEngineHost's identifyUser/resetIdentity wiring
// (src/sync/SyncEngineHost.tsx) is unaffected either way.
if (import.meta.env.DEV && env.VITE_DEV_IDENTITY_USER_ID) {
  identifyUser(env.VITE_DEV_IDENTITY_USER_ID)
}
// Fire-and-forget, deliberately not awaited before the two calls above:
// blocking app boot on an IndexedDB read just to attach one telemetry
// property would cost real first-paint time for zero user-facing benefit.
// This device's profile (and its anonId) resolves in single-digit
// milliseconds in practice — session_start may rarely fire a moment before
// this resolves, but every event captured after it (which is effectively
// all of them, on any session where the player does anything) carries the
// registered super property. See telemetry/client.ts's registerAnonId doc
// comment for the full mechanism decision.
//
// Dynamic import of './storage', not a static one (pre-merge review
// finding): a static import here permanently merges the storage module
// into whatever shared chunk main.tsx's own eager dependency graph
// produces — measured to land it in the same chunk as the lazily-loaded
// posthog-js/env bundle, so any future storage-only change (a schema
// field, a migration) would re-hash that shared chunk and force every
// returning PWA user to re-download it too, unrelated to what actually
// changed. A dynamic import keeps this call's storage dependency exactly
// where it already was before this item: its own lazily-fetched chunk.
//
// `.catch` (pre-merge review finding): loadProfile can reject — a blocked/
// unavailable IndexedDB (private-mode Firefox, a locked-down webview) —
// and this was previously an unhandled rejection at boot. The telemetry
// property is genuinely optional, so report and move on rather than
// throw; every other async storage read in this app already handles this
// the same way.
void import('./storage')
  .then(({ loadProfile }) => loadProfile())
  .then((profile) => {
    registerAnonId(profile.anonId)
  })
  .catch((error: unknown) => {
    trackError(error, 'main: loadProfile failed for anonId registration')
  })

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
