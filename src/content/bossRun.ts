/**
 * Boss run v1 — a single hand-authored, fixed-order sequence of 10 puzzle
 * ids, escalating difficulty. See docs/v3-build-plan.md Phase 1 "Design
 * questions — settled": curated fixed sets over rating-laddered draws,
 * chosen for pacing/narrative control over a run — a boss fight reads as
 * authored escalation, not a random sample that happens to trend harder.
 *
 * v1 SCOPE, NOT THE FINAL SHAPE: this file holds exactly one set because
 * that's all v3 Phase 1 needs to ship Boss at all — every run currently
 * plays the identical 10 puzzles in the identical order (best-score-only
 * makes that a feature, not a bug: replay to beat your own depth). This is a
 * known, deliberate gap, flagged here on purpose: Boss WILL need more than
 * one curated set soon after launch (a single fixed sequence's novelty runs
 * out fast for a repeat player). When that's built, replace this single
 * `BOSS_RUN` array with a `BOSS_SETS: readonly (readonly string[])[]`
 * registry plus a selection function (rotate by runs completed, or a
 * calendar index mirroring dailyCalendar.ts's `getDailyCalendarIndex`) —
 * both were considered and explicitly deferred out of this phase, not
 * silently punted. See the Boss Challenges implementation plan's own
 * "Design record" section for the full decision.
 *
 * Excludes scrubber puzzles: Boss's strike model needs a binary
 * correct/wrong outcome per puzzle, which scrubber's per-checkpoint partial
 * credit doesn't produce — same reasoning as DAILY_CALENDAR's own scrubber
 * exclusion (see validatePuzzles.ts's validateDailyCalendar doc comment).
 *
 * Every id below is validated against the real content pool by
 * validateBossRun (validatePuzzles.ts), wired into `pnpm validate:content`,
 * and against the real quizPool by bossRun.test.ts.
 */
export const BOSS_RUN: readonly string[] = [
  'oob-001', //  900 mcq          off-by-one
  'err-005', // 1075 swipe-binary error-handling
  'mut-003', // 1200 tap-line     mutable-state
  'inp-011', // 1275 drag-order   input-validation
  'dsm-021', // 1375 swipe-binary data-structure-misuse
  'con-006', // 1500 mcq          concurrency
  'rec-003', // 1600 tap-line     recursion-termination
  'dsm-007', // 1700 tap-line     data-structure-misuse
  'con-007', // 1800 mcq          concurrency
  'inp-004', // 2075 swipe-binary input-validation
]
