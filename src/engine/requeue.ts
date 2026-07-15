/**
 * Requeue ladder for missed (incorrectly-answered) practice puzzles.
 *
 * A missed puzzle resurfaces three times at growing intervals, then exits the
 * requeue permanently. All state is immutable: every function takes a
 * RequeueState value in and returns a fresh one out.
 */

// The three ladder intervals, in "subsequent practice puzzles served".
//
// AMBIGUITY RESOLUTION (locked): "resurfaces after 3, then 10, then 25" is read
// as RELATIVE / RESTARTING offsets, not cumulative offsets from the original
// miss. That is: due 3 puzzles after the miss, then 10 puzzles after *that*
// resurfacing, then 25 puzzles after *that* one (so absolute ticks 3, 13, 38 in
// the simplest un-interrupted case). The alternative reading — cumulative
// offsets due at the 3rd / 13th / 38th... no: cumulative would be due at the
// 3rd, then 3+10=13th, then 13+25=38th tick counted from the ORIGINAL miss with
// a single never-resetting counter. Both readings happen to coincide on tick
// numbers when nothing interrupts, but they differ the moment a resurfacing is
// delayed (e.g. its puzzle is temporarily absent from the pool): relative
// offsets re-anchor each countdown on the *actual* resurfacing, cumulative ones
// do not. Relative offsets are the standard spaced-repetition design (growing
// gaps between successive reviews of the same item) and read most naturally as
// three independent "wait N more puzzles" steps, so that is what we implement:
// each `served` counter resets to 0 on resurfacing (see `resurface`).
const LADDER_INTERVALS = [3, 10, 25] as const

const LAST_STAGE = 2

/** Which of the three ladder stages an entry is currently waiting through. */
export type RequeueStage = 0 | 1 | 2

export interface RequeueEntry {
  readonly puzzleId: string
  readonly stage: RequeueStage
  /** Subsequent practice puzzles served since this entry entered `stage`. */
  readonly served: number
}

export type RequeueState = readonly RequeueEntry[]

export interface AdvanceResult {
  readonly state: RequeueState
  /**
   * Entries that are due to resurface as of this tick, in priority order
   * (earliest-missed first — see below). The caller serves at most one per
   * tick; any others remain due on following ticks.
   */
  readonly due: readonly RequeueEntry[]
}

export const emptyRequeueState: RequeueState = []

/**
 * Record a miss. Adds a fresh entry at stage 0. If the puzzle is already in the
 * requeue, its entry is RESET back to stage 0 (in place, preserving its
 * earliest-missed ordering slot): a second miss means the spacing should
 * restart from the beginning rather than continue an in-flight ladder.
 */
export function recordMiss(state: RequeueState, puzzleId: string): RequeueState {
  const fresh: RequeueEntry = { puzzleId, stage: 0, served: 0 }
  if (state.some((entry) => entry.puzzleId === puzzleId)) {
    return state.map((entry) => (entry.puzzleId === puzzleId ? fresh : entry))
  }
  return [...state, fresh]
}

/**
 * Called exactly once per practice puzzle served. Increments every pending
 * entry's `served` counter by one and reports which entries just became due.
 *
 * Priority order for multiple simultaneously-due entries is insertion order
 * (earliest-missed first): `state` preserves the order entries were added by
 * `recordMiss`, and `filter` keeps that order.
 */
export function advance(state: RequeueState): AdvanceResult {
  const next = state.map((entry) => ({ ...entry, served: entry.served + 1 }))
  const due = next.filter((entry) => entry.served >= LADDER_INTERVALS[entry.stage])
  return { state: next, due }
}

/**
 * Called when a due entry is actually resurfaced (served). Advances that entry
 * to the next ladder stage with its `served` counter reset to 0 (the relative
 * re-anchoring described at LADDER_INTERVALS). If it was already on the final
 * stage, the entry is removed entirely so it can never resurface a 4th time.
 */
export function resurface(state: RequeueState, puzzleId: string): RequeueState {
  return state.flatMap((entry) => {
    if (entry.puzzleId !== puzzleId) {
      return [entry]
    }
    if (entry.stage >= LAST_STAGE) {
      return []
    }
    const nextStage = (entry.stage + 1) as RequeueStage
    return [{ ...entry, stage: nextStage, served: 0 }]
  })
}
