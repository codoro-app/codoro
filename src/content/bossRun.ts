/**
 * Boss run registry — v2 of Boss's content, replacing the single
 * hand-authored `BOSS_RUN` array v1 shipped with (see git history/
 * docs/superpowers/plans/2026-08-10-boss-challenges.md for that shape).
 * `bossRun.ts`'s own v1 doc comment named this exact step as the deferred
 * next move: "Boss WILL need more than one curated set soon after launch —
 * a single fixed sequence's novelty runs out fast for a repeat player."
 * This is that step, done: `BOSS_SETS` is now a small registry of curated
 * 10-puzzle sequences, and `resolveActiveBossSet` picks which one a given
 * run serves.
 *
 * Each set follows the same authoring rules the original set did: exactly
 * 10 unique ids, non-scrubber (Boss's strike model needs a binary
 * correct/wrong outcome per puzzle — see validateBossRun's doc comment in
 * validatePuzzles.ts), non-decreasing difficulty_rating. Every id in every
 * set is validated against the real content pool by validateBossRun,
 * looped over BOSS_SETS from validateContent.ts (wired into
 * `pnpm validate:content`), and against the real quizPool by
 * bossRun.test.ts.
 *
 * Selection is deterministic, no RNG: `resolveActiveBossSet` is a pure
 * function of "how many runs has this player completed" — the same
 * `bossStats.runs` counter Boss already persists and already increments
 * once per completed run (useBossSession's endRun), so rotation needed no
 * new schema state. A fresh profile (bossStats: null, so runsCompleted
 * defaults to 0) always resolves BOSS_SETS[0] — the original set stays
 * everyone's first boss fight. The resolver takes the registry as an
 * explicit parameter (defaulting to the real BOSS_SETS) rather than
 * closing over it, the same way engine/daily.ts's getDailyCalendarIndex
 * takes calendarLength as a parameter instead of reading DAILY_CALENDAR.length
 * internally — it keeps the selection math testable against a small fixture
 * registry, independent of how many real sets happen to exist.
 */
export const BOSS_SETS: readonly (readonly string[])[] = [
  [
    // Set 0 — the original v1 BOSS_RUN, unchanged: 900 -> 2075, spans
    // off-by-one/error-handling/mutable-state/input-validation/
    // data-structure-misuse/concurrency/recursion-termination.
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
  ],
  [
    // Set 1 — 900 -> 1875, spans off-by-one/input-validation/type-coercion/
    // string-formatting/recursion-termination/scope-closures/mutable-state/
    // resource-management/concurrency. All ids distinct from set 0 (not a
    // hard requirement, just chosen for a repeat player's actual novelty).
    'oob-004', //  900 mcq          off-by-one
    'inp-005', // 1100 tap-line     input-validation
    'tc-022', // 1125 drag-order   type-coercion
    'str-009', // 1150 swipe-binary string-formatting
    'rec-009', // 1200 drag-order   recursion-termination
    'scl-001', // 1300 mcq          scope-closures
    'mut-008', // 1375 swipe-binary mutable-state
    'res-013', // 1425 mcq          resource-management
    'con-005', // 1800 mcq          concurrency
    'oob-007', // 1875 swipe-binary off-by-one
  ],
  [
    // Set 2 — 900 -> 1975, spans resource-management/off-by-one/
    // control-flow/input-validation/scope-closures/concurrency/
    // recursion-termination. Ids distinct from sets 0 and 1, same reasoning.
    'res-006', //  900 mcq          resource-management
    'oob-022', // 1025 drag-order   off-by-one
    'cf-024', // 1075 drag-order   control-flow
    'inp-008', // 1100 mcq          input-validation
    'cf-004', // 1175 swipe-binary control-flow
    'res-003', // 1200 tap-line     resource-management
    'inp-009', // 1275 swipe-binary input-validation
    'scl-023', // 1325 mcq          scope-closures
    'con-012', // 1775 drag-order   concurrency
    'rec-007', // 1975 swipe-binary recursion-termination
  ],
]

/**
 * Picks which entry of `sets` a run with `runsCompleted` prior completions
 * should serve — a plain modulo cycle (0 -> sets[0], 1 -> sets[1], ...,
 * sets.length -> sets[0] again), same "wrap once you run past the end"
 * shape as dailyCalendar's getDailyCalendarIndex. Pure and parameterized on
 * the registry (see this file's module doc comment for why) so it's
 * unit-testable against a small fixture array, independent of how many
 * real BOSS_SETS exist.
 *
 * Callers pass `profile.bossStats?.runs ?? 0` for `runsCompleted` — a fresh
 * profile (bossStats: null) resolves runsCompleted 0, which always maps to
 * sets[0], by construction.
 */
export function resolveActiveBossSet(
  runsCompleted: number,
  sets: readonly (readonly string[])[] = BOSS_SETS,
): readonly string[] {
  if (sets.length === 0) {
    throw new Error('resolveActiveBossSet: sets must be non-empty')
  }
  const index = runsCompleted % sets.length
  const set = sets[index]
  if (!set) {
    // Unreachable: index is `% sets.length`, always within bounds of a
    // non-empty array — this exists only to satisfy noUncheckedIndexedAccess.
    throw new Error('resolveActiveBossSet: unreachable — index out of bounds')
  }
  return set
}
