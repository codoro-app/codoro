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
  trackPracticeAttempt,
  trackComboShieldUsed,
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
  trackMissionStart,
  trackMissionStageComplete,
  trackMissionAbandoned,
  trackMissionFinished,
  trackRouteView,
  trackPageview,
  trackFeedbackLinkClicked,
  trackFirstRunStepComplete,
  trackFirstRunCompleted,
  trackError,
} from './events'
export type {
  MissionStartPayload,
  MissionStageCompletePayload,
  MissionAbandonedPayload,
  MissionFinishedPayload,
  AttemptEventPayload,
  PracticeAttemptContext,
  ComboShieldUsedPayload,
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
  SessionStartPayload,
  RouteViewPayload,
  FeedbackLinkClickedPayload,
  FirstRunStepCompletePayload,
  FirstRunCompletedPayload,
} from './events'
