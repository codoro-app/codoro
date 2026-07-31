/**
 * Public entry point for telemetry — the single choke point for all
 * analytics events in this app.
 *
 * Everything outside src/telemetry/ must import from here, never reach into
 * client.ts/events.ts directly, and never `import posthog from 'posthog-js'`
 * itself — same barrel convention as engine/ and storage/.
 */
export { initTelemetry } from './client'
export {
  trackSessionStart,
  trackAttempt,
  trackRushAttempt,
  trackRushRunEnd,
  trackTraceAttempt,
  trackPuzzleLinkView,
  trackPuzzleLinkAttempt,
  trackShareClick,
  trackError,
} from './events'
export type {
  AttemptEventPayload,
  RushAttemptContext,
  RushRunEndPayload,
  TraceAttemptContext,
  PuzzleLinkViewPayload,
  PuzzleLinkAttemptPayload,
  ShareClickPayload,
} from './events'
