/**
 * Thin bar shown above the current puzzle on a `/challenge` run, racing the
 * challenger's own recorded time for this puzzle — the async challenge's
 * "feel live" pass. Text-only under `prefers-reduced-motion` (the CSS fill
 * animation is disabled there; `ghostBar.css`'s own media query owns that,
 * this component always renders the same label/state regardless). No sound,
 * no modal, never blocks input — see `useGhostRace`'s own doc comment for
 * the state machine this renders.
 */
import type { CSSProperties } from 'react'
import { useGhostRace } from './useGhostRace'
import type { GhostRaceResult } from './useGhostRace'
import './ghostBar.css'

export interface GhostBarProps {
  /** The original challenger's display name, or null — falls back to "Friend", same convention as the intro hero and comparison screen. */
  challengerName: string | null
  /** The challenger's own recorded result for the puzzle currently on screen, or undefined if the payload has none at this index (no ghost to show). */
  theirResult: GhostRaceResult | undefined
  /** The recipient's own result for this same puzzle, once answered — undefined until then. */
  yourResult: GhostRaceResult | undefined
  /** When the recipient's clock for this puzzle started — the same `servedAt` signal `useChallengeSession` already tracks for `time_ms`. */
  servedAt: number | null
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

export function GhostBar({ challengerName, theirResult, yourResult, servedAt }: GhostBarProps) {
  const state = useGhostRace(theirResult, yourResult, servedAt)
  if (!state || !theirResult) return null

  const name = challengerName ?? 'Friend'
  const label =
    state.status === 'running'
      ? `${name} · ${formatSeconds(state.theirTimeMs)}`
      : state.status === 'beaten'
        ? `+${formatSeconds(state.marginMs ?? 0)} ahead`
        : theirResult.correct
          ? `${name} finished`
          : `${name} missed this one`

  const fillStyle: CSSProperties =
    state.status === 'running'
      ? ({ '--ghost-duration-ms': `${String(state.theirTimeMs)}ms` } as CSSProperties)
      : state.status === 'beaten'
        ? ({ '--ghost-frozen-fraction': String(state.frozenFraction ?? 0) } as CSSProperties)
        : {}

  return (
    // aria-live (not role="status" — that role already means "the feedback
    // panel is showing" elsewhere on this page, e.g. PuzzleCardShell's own
    // post-commit panel; reusing it here would make a pre-answer ghost bar
    // register as a feedback panel to anything querying by that role).
    // Announced politely on state changes; never grabs focus.
    <div
      className="ghost-bar"
      data-ghost-status={state.status}
      aria-live="polite"
      style={fillStyle}
    >
      <span className="ghost-bar__label">{label}</span>
    </div>
  )
}
