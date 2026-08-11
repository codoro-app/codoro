/**
 * Public entry point for telemetry — the single choke point for all
 * analytics events in this app.
 *
 * Everything outside src/telemetry/ must import from here, never reach into
 * client.ts/events.ts directly, and never `import posthog from 'posthog-js'`
 * itself — same barrel convention as engine/ and storage/.
 */
export { initTelemetry, registerAnonId } from './client'
export {
  trackSessionStart,
  trackAttempt,
  trackRushAttempt,
  trackRushRunEnd,
  trackBossAttempt,
  trackBossRunEnd,
  trackTraceAttempt,
  trackPuzzleLinkView,
  trackPuzzleLinkAttempt,
  trackShareClick,
  trackStreakPause,
  trackChallengeCreate,
  trackChallengeLinkView,
  trackChallengeLinkComplete,
  trackError,
} from './events'
export type {
  AttemptEventPayload,
  RushAttemptContext,
  RushRunEndPayload,
  BossAttemptContext,
  BossRunEndPayload,
  TraceAttemptContext,
  PuzzleLinkViewPayload,
  PuzzleLinkAttemptPayload,
  ShareClickPayload,
  StreakPausePayload,
  ChallengeCreatePayload,
  ChallengeLinkViewPayload,
  ChallengeLinkCompletePayload,
} from './events'
