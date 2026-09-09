/**
 * Ghost-race state for the puzzle currently on screen in a `/challenge` run
 * (async challenge, made to feel live). Reuses the SAME clock
 * `useChallengeSession` already starts for the recipient's own `time_ms`
 * (`servedAt`, stamped once per puzzle by `handleAccept`/`handleContinue`) —
 * no second timer source, no new telemetry.
 *
 * Returns `null` when there's nothing to show: no result recorded for this
 * puzzle in the challenger's payload, or the clock for this puzzle hasn't
 * started yet (still on the intro hero). Otherwise resolves to exactly one
 * of three states:
 *
 * - `'running'`: the challenger's own time for this puzzle hasn't elapsed
 *   yet, and the recipient hasn't answered. `GhostBar` fills a bar over
 *   `theirTimeMs` from `servedAt`.
 * - `'finished'`: the challenger's time elapsed before the recipient
 *   answered (or the recipient answered slower than the challenger did —
 *   arriving here directly with no visible 'running' phase in that case).
 * - `'beaten'`: the recipient answered strictly before the challenger's
 *   time elapsed. Frozen, not live — `frozenFraction`/`marginMs` are
 *   computed once from the two recorded times, not from an ongoing clock.
 *
 * The only timer this hook owns is a single `setTimeout` scheduled for
 * exactly when the challenger's time would elapse (mirroring
 * `PuzzleCardShell`'s own auto-advance countdown pattern) — used solely to
 * trigger the 'running' -> 'finished' re-render; it never affects any
 * recorded `time_ms` value. `Date.now()` is only ever called inside that
 * effect, never in the render path itself (react-hooks/purity) — `elapsed`
 * below is plain state the effect flips once, not a fresh sample taken
 * during render.
 */
import { useEffect, useState } from 'react'

export type GhostRaceStatus = 'running' | 'finished' | 'beaten'

/**
 * The only two fields ghost-race math ever needs from a per-puzzle result.
 * Deliberately narrower than `ChallengeAttemptInput` (which also carries
 * `puzzleId`): `payload.results[i]` is `ChallengePayloadSchema`'s own
 * `{correct, time_ms}` result shape, not a full attempt — ids live in the
 * parallel `payload.ids` array instead. `session.results[i]` (a real
 * `ChallengeAttemptInput`) satisfies this structurally too, so one type
 * covers both call sites without either needing to fabricate a `puzzleId`.
 */
export interface GhostRaceResult {
  correct: boolean
  time_ms: number
}

export interface GhostRaceState {
  status: GhostRaceStatus
  /** The challenger's own time for this puzzle, ms. Always present alongside a non-null state. */
  theirTimeMs: number
  /** 'beaten' only: how far ahead the recipient finished, ms. */
  marginMs?: number
  /** 'beaten' only: fraction (0-1) of the challenger's duration that had elapsed when the recipient answered — freezes the bar there instead of snapping to empty or full. */
  frozenFraction?: number
}

export function useGhostRace(
  theirResult: GhostRaceResult | undefined,
  yourResult: GhostRaceResult | undefined,
  servedAt: number | null,
): GhostRaceState | null {
  // Whether the challenger's own time has elapsed for THIS puzzle, without
  // the recipient having answered first. Reset per puzzle (a new
  // theirResult/servedAt) before deciding whether to start a fresh
  // countdown — same "reset, then decide" shape as PuzzleCardShell.tsx's
  // own autoAdvanceStartedAt effect, and the same reason its
  // set-state-in-effect disable is warranted: this IS synchronizing local
  // state to a prop change, not the anti-pattern the rule otherwise guards
  // against.
  const [elapsed, setElapsed] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting for a new puzzle, not the reset-on-every-render anti-pattern the rule targets; see this hook's own doc comment.
    setElapsed(false)
    if (!theirResult || servedAt === null || yourResult) return
    const remaining = theirResult.time_ms - (Date.now() - servedAt)
    const timer = window.setTimeout(
      () => {
        setElapsed(true)
      },
      Math.max(remaining, 0),
    )
    return () => {
      window.clearTimeout(timer)
    }
  }, [theirResult, servedAt, yourResult])

  if (!theirResult || servedAt === null) return null

  if (yourResult) {
    if (yourResult.time_ms < theirResult.time_ms) {
      return {
        status: 'beaten',
        theirTimeMs: theirResult.time_ms,
        marginMs: theirResult.time_ms - yourResult.time_ms,
        frozenFraction: yourResult.time_ms / theirResult.time_ms,
      }
    }
    return { status: 'finished', theirTimeMs: theirResult.time_ms }
  }

  return { status: elapsed ? 'finished' : 'running', theirTimeMs: theirResult.time_ms }
}
