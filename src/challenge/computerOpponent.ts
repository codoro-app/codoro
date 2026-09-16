/**
 * Synthesizes both halves of a "Play Computer" challenge run — the 5-puzzle
 * draw and the opponent's own `{correct, time_ms}` results — from a target
 * rating, with zero live-solving involved (see this file's own module doc:
 * the "computer" is a pre-baked payload, exactly as static as a real
 * challenger's, never an agent). Pure, deterministic under an injected
 * `Rng` (never `Math.random` internally — same convention
 * src/engine/selection.ts already establishes) so this stays directly
 * unit-testable against fixed seeds.
 *
 * Produces a `ChallengePayload` matching exactly what `buildChallengePayload`
 * (codec.ts) produces from real attempts — same shape, same version, same
 * `totalMs` derivation — so every downstream consumer (`useChallengeSession`,
 * `useGhostRace`, `GhostBar`, `ChallengeComparison`) needs zero changes to
 * play a synthetic run.
 */
import { expectedScore, widenedEligible } from '../engine'
import type { Puzzle, Rng } from '../engine'
import { CHALLENGE_PAYLOAD_VERSION, MAX_CHALLENGE_PUZZLES } from './schema'
import type { ChallengePayload } from './schema'

/**
 * Mirrors src/app/practice/feel.ts's `RatingTier` literal-for-literal
 * (novice/steady/sharp/elite) — one Elo-tier vocabulary app-wide, per the
 * source prompt's explicit instruction not to invent a second one. Kept as
 * an independent type here rather than imported: src/challenge/ is a
 * dependency-free domain module (same layering src/engine/ enforces on
 * itself — see eslint.config.js's engine-scoped no-restricted-imports
 * rule) and must not import from src/app/.
 */
export type EloTier = 'novice' | 'steady' | 'sharp' | 'elite'

/**
 * Draw center per tier. `steady`/`sharp`/`elite` use that tier's own Elo
 * floor (feel.ts's `ratingTier` thresholds: 1300/1500/1700) + 50, landing
 * the draw solidly inside the tier's band rather than right on the boundary
 * it shares with the tier below. `novice` has no floor of its own (feel.ts
 * treats anything under 1300 as novice), so it gets a flat target instead
 * of a floor+50 derivation. Tune by editing these four numbers — nothing
 * else needs to change.
 */
export const TIER_TARGET_RATING: Record<EloTier, number> = {
  novice: 1100,
  steady: 1350,
  sharp: 1550,
  elite: 1750,
}

/** Fixed, clearly-not-a-person challenger name — see schema.ts's own `challengerName` doc comment for why this never blocks the 1-40 char bound. */
export const COMPUTER_CHALLENGER_NAME = 'Codoro Bot'

interface TimeProfile {
  meanMs: number
  jitterMs: number
}

/**
 * Per-tier synthetic solve-time profile: `meanMs` is the center,
 * `jitterMs` the uniform +/- spread `synthesizeTimeMs` samples from the
 * injected rng. Higher tiers solve faster (lower mean, tighter jitter) — a
 * feel parameter, tune by editing these two numbers per tier.
 */
const TIER_TIME_PROFILE: Record<EloTier, TimeProfile> = {
  novice: { meanMs: 25_000, jitterMs: 8_000 },
  steady: { meanMs: 18_000, jitterMs: 6_000 },
  sharp: { meanMs: 13_000, jitterMs: 5_000 },
  elite: { meanMs: 9_000, jitterMs: 3_500 },
}

/** A miss plausibly took longer than a hit — more time spent second-guessing before committing — encoded as a flat multiplier on the sampled base time, not a separate table. Tune by editing this one number. */
const INCORRECT_TIME_MULTIPLIER = 1.35

/** Floor so a large negative jitter roll can never synthesize a ~0ms or negative time. */
const MIN_SYNTHESIZED_TIME_MS = 1_000

/** Samples `tier`'s time profile via the injected rng, applying the miss multiplier when `correct` is false. Exported for direct unit testing. */
export function synthesizeTimeMs(tier: EloTier, correct: boolean, rng: Rng): number {
  const profile = TIER_TIME_PROFILE[tier]
  const jitter = (rng() * 2 - 1) * profile.jitterMs
  const base = Math.max(MIN_SYNTHESIZED_TIME_MS, profile.meanMs + jitter)
  return Math.round(correct ? base : base * INCORRECT_TIME_MULTIPLIER)
}

/**
 * Samples up to `count` DISTINCT puzzles from `eligible` (no replacement) —
 * unlike Practice's own `sample` (selection.ts), which can legally re-serve
 * within a session; a computer "run" repeating the same puzzle twice would
 * look broken, not deliberate, to a recipient racing it once. Returns fewer
 * than `count` only if `eligible` itself has fewer entries (the real
 * puzzlePool always has far more than 5 eligible puzzles at every tier —
 * this only bites tiny fixture pools in tests). Partial Fisher-Yates
 * shuffle, same deterministic-rng, noUncheckedIndexedAccess-safe guard
 * convention as selection.ts's own `sample`.
 */
export function sampleDistinctIds(eligible: readonly Puzzle[], count: number, rng: Rng): Puzzle[] {
  const pool = [...eligible]
  const picked: Puzzle[] = []
  const n = Math.min(count, pool.length)
  for (let i = 0; i < n; i++) {
    const remaining = pool.length - i
    const j = i + Math.floor(rng() * remaining)
    const chosen = pool[j]
    const atI = pool[i]
    if (chosen === undefined || atI === undefined) {
      throw new Error('sampleDistinctIds: index out of range (rng returned a value >= 1?)')
    }
    pool[j] = atI
    pool[i] = chosen
    picked.push(chosen)
  }
  return picked
}

/**
 * Builds a synthetic "Play Computer" `ChallengePayload`: draws
 * `MAX_CHALLENGE_PUZZLES` distinct puzzles from `pool` within a widened
 * rating window around `tier`'s target, then rolls each one's correctness
 * against `expectedScore` (the puzzle's own difficulty vs. the target
 * rating) and synthesizes a plausible `time_ms`. `pool` is the caller's own
 * `{id, rating}`-adapted puzzle set (same adapter `usePracticeSession.ts`
 * already uses) — this function has no opinion on where it came from.
 */
export function buildComputerChallengePayload(
  tier: EloTier,
  pool: readonly Puzzle[],
  rng: Rng,
): ChallengePayload {
  const targetRating = TIER_TARGET_RATING[tier]
  const eligible = widenedEligible(pool, targetRating)
  const drawn = sampleDistinctIds(eligible, MAX_CHALLENGE_PUZZLES, rng)

  const ids: string[] = []
  const results: { correct: boolean; time_ms: number }[] = []
  let totalMs = 0
  for (const puzzle of drawn) {
    const correct = rng() < expectedScore(targetRating, puzzle.rating)
    const time_ms = synthesizeTimeMs(tier, correct, rng)
    ids.push(puzzle.id)
    results.push({ correct, time_ms })
    totalMs += time_ms
  }

  return {
    v: CHALLENGE_PAYLOAD_VERSION,
    ids,
    results,
    totalMs,
    challengerName: COMPUTER_CHALLENGER_NAME,
  }
}
