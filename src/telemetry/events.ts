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

/** Run-level context attached to every Rush `attempt` event, additive to the locked AttemptEventPayload shape above (new fields, nothing renamed/removed). `timed_out` (Phase 5b Item 6): true when this attempt's outcome came from the per-puzzle clock reaching 0 rather than a real tap — a strike either way, but worth distinguishing at analysis time. */
export interface RushAttemptContext {
  run_id: string
  position_in_run: number
  difficulty_served: number
  timed_out: boolean
}

/** Fires the same `attempt` event as trackAttempt, with Rush's run-level context appended — so Rush attempts land in the same event stream (mode: 'rush') for calibration, per the build plan. */
export function trackRushAttempt(payload: AttemptEventPayload & RushAttemptContext): void {
  safeCapture('attempt', payload)
}

export interface RushRunEndPayload {
  run_id: string
  solved_count: number
  best_streak_in_run: number
  final_difficulty: number
  /** Phase 5b Item 6: which of the run's two ending conditions produced its final strike — a real wrong answer, or the per-puzzle clock reaching 0. Both still end the run the same way (same ended phase, same stats write); this only distinguishes the trigger for analysis. */
  ended_reason: 'strikes' | 'clock'
  /** Phase 5b Item 8: true when this run's solved_count just beat the profile's prior all-time bestScore — the run-ended screen's "new personal best" moment. Never fires on a rating basis (no rating-based celebration exists anywhere in this feature — the stored rating is still inflated by pre-rebalance blind-right swipes). */
  is_new_best_score: boolean
}

/** Fired once per completed Rush run (3 strikes), independent of the per-attempt `attempt` events above. */
export function trackRushRunEnd(payload: RushRunEndPayload): void {
  safeCapture('rush_run_end', payload)
}

/** Run-level context attached to every Boss `attempt` event, additive to the locked AttemptEventPayload shape above. No `difficulty_served`/`timed_out` (unlike Rush's own RushAttemptContext): Boss has no live difficulty selection and no per-puzzle clock — `position_in_run` alone identifies which fixed-sequence puzzle this was. `set_index` (BOSS_SETS rotation) names which curated set this run is playing, additive same as Rush's own `difficulty_served`, so set-level performance is queryable later. */
export interface BossAttemptContext {
  run_id: string
  position_in_run: number
  set_index: number
}

/** Fires the same `attempt` event as trackAttempt, with Boss's run-level context appended — so Boss attempts land in the same event stream (mode: 'boss') alongside every other mode's. */
export function trackBossAttempt(payload: AttemptEventPayload & BossAttemptContext): void {
  safeCapture('attempt', payload)
}

export interface BossRunEndPayload {
  run_id: string
  /** 1-indexed position of the last puzzle this run reached (whether that puzzle was answered right or wrong), capped at BOSS_RUN.length — see useBossSession's own doc comment ("depth reached"). */
  depth_reached: number
  /** True only when the run reached BOSS_RUN.length WITHOUT being struck out — see useBossSession's own doc comment for why depth alone (`depth_reached`) can't distinguish a clean finish on the last puzzle from losing the 3rd strike on it. */
  cleared: boolean
  /** Which of Boss's two ending conditions actually fired — independent of `cleared`/`depth_reached`, since a run can strike out anywhere, including on the final puzzle. */
  ended_reason: 'strikes' | 'completed'
  /** True when this run's depth_reached just beat the profile's prior all-time bestDepth. */
  is_new_best_depth: boolean
  /** Which curated BOSS_SETS entry this run played — see BossAttemptContext's own doc comment. */
  set_index: number
}

/** Fired once per completed Boss run (3 strikes or a full clear), independent of the per-attempt `attempt` events above. */
export function trackBossRunEnd(payload: BossRunEndPayload): void {
  safeCapture('boss_run_end', payload)
}

/** Per-checkpoint context attached to every Trace `attempt` event, additive to the locked AttemptEventPayload shape above (new fields, nothing renamed/removed). One entry per checkpoint on the puzzle, in answer order — mirrors the `checkpoint_results` field persisted on the Attempt record (src/storage/schema.ts's CheckpointResultSchema), just snake_cased for the analytics stream. `choice_index` is nullable and `timed_out` is additive (Phase 5b Item 6): a checkpoint whose per-checkpoint clock (30s) reached 0 before an answer reports `choice_index: null, timed_out: true` rather than reusing an existing value as a repurposed signal. */
export interface TraceAttemptContext {
  checkpoint_results: { correct: boolean; choice_index: number | null; timed_out: boolean }[]
}

/** Fires the same `attempt` event as trackAttempt, with Trace's per-checkpoint context appended — so Trace attempts land in the same event stream (mode: 'practice', per the build plan's shared-rating decision) with their checkpoint-level detail attached. Called once per completed puzzle (all checkpoints answered), not once per checkpoint. */
export function trackTraceAttempt(payload: AttemptEventPayload & TraceAttemptContext): void {
  safeCapture('attempt', payload)
}

/**
 * Fired once per `/puzzle/:id` page view. `found: false` is the signal that
 * someone shared a link that no longer resolves to a real bundled puzzle —
 * `interaction` is `null` in that case, since there's no puzzle to report
 * one for. Not part of the locked AttemptEventPayload schema above — this is
 * a new, additive event for the Phase 1b shareable-link surface.
 */
export interface PuzzleLinkViewPayload {
  puzzle_id: string
  interaction: Puzzle['interaction'] | null
  found: boolean
}

export function trackPuzzleLinkView(payload: PuzzleLinkViewPayload): void {
  safeCapture('puzzle_link_view', payload)
}

/**
 * Fired once a `/puzzle/:id` visitor completes an attempt (commits a quiz
 * answer, or answers every scrubber checkpoint). Deliberately never routed
 * through trackAttempt/trackTraceAttempt — `/puzzle/:id` attempts are never
 * rated (see the Phase 1b build plan's locked "don't record link attempts"
 * decision) and must not enter the locked `attempt` event stream those
 * functions feed. This event is the *only* record that link play happened.
 */
export interface PuzzleLinkAttemptPayload {
  puzzle_id: string
  interaction: Puzzle['interaction']
  correct: boolean
  time_ms: number
}

export function trackPuzzleLinkAttempt(payload: PuzzleLinkAttemptPayload): void {
  safeCapture('puzzle_link_attempt', payload)
}

/**
 * Fired whenever a share affordance is used — Daily and Rush's existing
 * post-solve ShareCard/RushShareCard, and Practice's new solve-state share
 * button (Phase 1b). `surface` names the calling mode.
 */
export interface ShareClickPayload {
  surface: 'daily' | 'rush' | 'practice'
  puzzle_id: string
}

export function trackShareClick(payload: ShareClickPayload): void {
  safeCapture('share_click', payload)
}

/**
 * Fired whenever the streak-pause moment (Phase 5b Item 7/8) is shown —
 * Practice and Trace only (decision 8). `is_new_best` distinguishes a pause
 * that carried the "new best streak" framing from one that didn't, per
 * Item 8's explicit telemetry ask. Not part of the locked `attempt` schema
 * — a new, additive event of its own.
 */
export interface StreakPausePayload {
  mode: 'practice' | 'trace'
  streak: number
  is_new_best: boolean
}

export function trackStreakPause(payload: StreakPausePayload): void {
  safeCapture('streak_pause', payload)
}

/**
 * Fired whenever a "Challenge a friend" affordance produces a shareable
 * challenge link — the start of every challenge flow (Phase 5c). `surface`
 * names the calling mode: the three own-modes' post-solve cards, or
 * `'challenge'` for a counter-challenge (the comparison screen re-encoding
 * the recipient's own run). `puzzle_count` is the number of puzzles the
 * encoded challenge carries (≤ the payload cap — long runs truncate to their
 * last 5). Not part of the locked `attempt` schema — a new, additive event.
 */
export interface ChallengeCreatePayload {
  surface: 'daily' | 'rush' | 'practice' | 'challenge'
  puzzle_count: number
}

export function trackChallengeCreate(payload: ChallengeCreatePayload): void {
  safeCapture('challenge_create', payload)
}

/**
 * Fired once per `/challenge` page view. `found: false` is the signal that
 * someone opened a challenge link that doesn't decode (malformed, truncated,
 * or unknown-version payload — the codec's every-failure-collapses-to-null
 * standard) or whose ids don't resolve to real bundled puzzles. The payload
 * is deliberately leaner than `puzzle_link_view`'s — there's no single puzzle
 * identity to report, and per the Phase 5c build plan the broken-link event
 * only needs to distinguish found from not.
 */
export interface ChallengeLinkViewPayload {
  found: boolean
}

export function trackChallengeLinkView(payload: ChallengeLinkViewPayload): void {
  safeCapture('challenge_link_view', payload)
}

/**
 * Fired once a challenge recipient finishes their run and the comparison
 * screen resolves. `beat_challenger` compares the recipient's total time
 * against the challenger's `totalMs` (the tiebreaker — a tie counts as
 * not-beating). The only telemetry record of a challenge's outcome:
 * challenge attempts are structurally unrated and never touch storage, so
 * this event is where the win/lose signal lives.
 */
export interface ChallengeLinkCompletePayload {
  beat_challenger: boolean
}

export function trackChallengeLinkComplete(payload: ChallengeLinkCompletePayload): void {
  safeCapture('challenge_link_complete', payload)
}

/**
 * Fired once a mission run actually begins (the checkpoint screen's "Start"
 * tap for a brand-new run — not fired again on resume-after-close, since
 * that's continuing an already-started run, not starting one). v3 Phase 2
 * Missions. Not part of the locked `attempt` schema — a new, additive event.
 */
export interface MissionStartPayload {
  run_id: string
}

export function trackMissionStart(payload: MissionStartPayload): void {
  safeCapture('mission_start', payload)
}

/**
 * Fired once per stage ending (Trace/Speed/Boss), independent of the
 * per-puzzle `attempt` events those stages already emit unmodified —
 * see docs/design/click-meaningfulness.md §3 for the state machine.
 * `ended_reason` names which of Missions' two stage-end conditions fired:
 * `'native'` only when the mode's own real end condition (Rush's 3 strikes,
 * Boss's 3 strikes/depth-10) beat the shared 60s clock; `'timer'` otherwise
 * (always `'timer'` for the Trace stage, which has no native end at all).
 * `stats` mirrors the discriminated MissionStageStats shape persisted in
 * storage (src/storage/schema.ts) so the analytics record and the stored
 * record never drift into two different vocabularies for the same stage.
 */
export interface MissionStageCompletePayload {
  run_id: string
  stage: 'trace' | 'speed' | 'boss'
  ended_reason: 'timer' | 'native'
  stats:
    | { stage_id: 'trace'; puzzles_completed: number; solved_count: number }
    | { stage_id: 'speed'; solved_count: number; best_streak_this_run: number }
    | { stage_id: 'boss'; depth_reached: number; cleared: boolean }
}

export function trackMissionStageComplete(payload: MissionStageCompletePayload): void {
  safeCapture('mission_stage_complete', payload)
}

/**
 * Fired only for the explicit "Exit mission" action (never for a bare tab
 * close, which is silently resumable by design — see the design doc's §3
 * abandon/resume mechanism). `completed_stage_count` records how far the
 * run got before it was abandoned.
 */
export interface MissionAbandonedPayload {
  run_id: string
  stage: 'trace' | 'speed' | 'boss'
  completed_stage_count: number
}

export function trackMissionAbandoned(payload: MissionAbandonedPayload): void {
  safeCapture('mission_abandoned', payload)
}

/**
 * Fired once a mission run completes all three stages (the payoff/
 * celebration screen). `completions` is the profile's new all-time total
 * after this run, mirroring rush_run_end's/boss_run_end's own
 * is_new_best-style "post-update" convention rather than a pre-update count.
 */
export interface MissionFinishedPayload {
  run_id: string
  completions: number
}

export function trackMissionFinished(payload: MissionFinishedPayload): void {
  safeCapture('mission_finished', payload)
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
