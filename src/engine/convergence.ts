/**
 * Deterministic convergence simulation for the rating engine.
 * Pure functions; the test harness owns all reporting I/O.
 */
import { expectedScore, updateRating } from './rating'

export interface SimulationResult {
  trueRating: number
  startRating: number
  // trajectory[i] is the tracked rating after i attempts; length is puzzleCount + 1.
  trajectory: number[]
  finalRating: number
  delta: number
}

// mulberry32: a tiny, fast, well-distributed seeded PRNG. Returns a generator
// closure so a fresh seed always reproduces the same sequence. The mutable state
// is local to the closure (not module-level), keeping the module itself pure.
export function createRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function simulate(
  trueRating: number,
  startRating: number,
  puzzleCount: number,
  rng: () => number,
): SimulationResult {
  const trajectory: number[] = [startRating]
  let tracked = startRating
  for (let i = 0; i < puzzleCount; i++) {
    // Pool-matching assumption: the served puzzle's rating equals the user's
    // current tracked rating (the simplest realistic selector — see selection.ts).
    const puzzleRating = tracked
    // The user's *true, fixed* skill decides the coin flip; the tracked rating
    // only drives which puzzle is served and how the update is scored.
    const winProbability = expectedScore(trueRating, puzzleRating)
    const correct = rng() < winProbability
    tracked = updateRating(tracked, puzzleRating, correct, i)
    trajectory.push(tracked)
  }
  return {
    trueRating,
    startRating,
    trajectory,
    finalRating: tracked,
    delta: tracked - trueRating,
  }
}
