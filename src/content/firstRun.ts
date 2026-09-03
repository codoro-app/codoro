/**
 * The curated, fixed-order 3-puzzle sequence served to every brand-new
 * profile's very first session — Home's gate (see Home.tsx's own doc
 * comment) reaches for this instead of the live rating-window selector,
 * which often serves mcq/swipe-binary on turn one: those interactions read
 * like flashcards, not puzzles, and are exactly the reason most first-time
 * visitors bounce (see docs/superpowers/plans/2026-09-03-first-run-sequence-
 * design.md's Problem section). Mirrors bossRun.ts's own "curated id list
 * instead of the live selector" pattern almost exactly — validated the same
 * way (validateFirstRunSet in validatePuzzles.ts, wired into
 * validateContent.ts's main()) and unit-tested against the real content pool
 * (firstRun.test.ts, mirroring bossRun.test.ts).
 *
 * Exactly 3 ids, escalating INTERACTION complexity rather than escalating
 * difficulty_rating the way BOSS_SETS does (Boss's whole premise is
 * "escalating difficulty"; first-run's premise is "a real aha on your very
 * first puzzle, three times over, without ever feeling like a quiz"):
 *
 * 1. `cf-002` — tap-line, 1300, control-flow (nested-loop `break` only exits
 *    the inner loop — a single-line spot-the-bug, the simplest possible
 *    "find one thing" interaction).
 * 2. `oob-021` — drag-order, 1150, off-by-one (a deliberately short 4-block
 *    reorder — an 8-block drag-order puzzle is too much cognitive load for
 *    someone's first-ever puzzle).
 * 3. `dsm-016` — scrubber, 1125, data-structure-misuse (`.pop()` on a
 *    "queue" — 4 checkpoints, self-contained), the richest interaction the
 *    sequence has, saved for last once the player has already had two wins.
 *
 * Ratings stay inside a tight [1000, 1300] band throughout (validated
 * below) — a first-ever puzzle should feel winnable, not calibrate-y.
 *
 * None of these three ids appear in any `BOSS_SETS` entry (validated below,
 * and grep-verified while authoring this list) — deliberate, so a first-run
 * graduate's first Boss run doesn't immediately repeat a puzzle they just
 * solved minutes earlier.
 */
export const FIRST_RUN_SET: readonly string[] = ['cf-002', 'oob-021', 'dsm-016']
