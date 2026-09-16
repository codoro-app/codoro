/**
 * `/compete` — a new, purely-additive multiplayer entry point: two doors
 * into the exact same `/challenge` run the app already has on the
 * recipient's side. "Play Computer" synthesizes both the puzzle set and the
 * opponent's results from a target rating and races them immediately.
 * "Play Human" draws the same way but has the initiator generate the
 * results by actually solving the 5 puzzles, then hands the result to the
 * existing, unmodified `ChallengeButton` for a real 1-on-1 share link.
 *
 * This file starts as the menu only — the level picker and both doors'
 * live wiring land in later tasks (see the plan this file was built from,
 * docs/superpowers/plans/2026-09-16-compete-play-computer.md).
 */
import { useState } from 'react'

const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[var(--space-4)] px-4 pb-4'

// Home.tsx's own CARD_BASE-style literal class string, duplicated here
// rather than imported — Home.tsx keeps its own CARD_* constants
// module-local (see its own comment on MODE_LABELS), matching this
// codebase's established per-file convention for presentation-only
// class-string constants (e.g. ChallengePage.tsx's own PAGE_SHELL_CLASS).
const DOOR_CARD_CLASS =
  'flex flex-col items-start gap-2 min-h-11 w-full p-5 rounded-md border border-accent bg-surface-1 text-left text-text-0 cursor-pointer lg:transition-[transform,border-color] lg:duration-150 lg:hover:-translate-y-0.5 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

type Door = { kind: 'menu' } | { kind: 'computer-level' } | { kind: 'human-level' }

export function CompetePage() {
  const [door, setDoor] = useState<Door>({ kind: 'menu' })

  return (
    <div className={PAGE_SHELL_CLASS}>
      <p className="m-0 text-xl font-bold text-text-0">Compete</p>
      {door.kind === 'menu' && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            className={DOOR_CARD_CLASS}
            onClick={() => {
              setDoor({ kind: 'computer-level' })
            }}
          >
            <span className="text-lg font-bold">Play Computer</span>
            <span className="text-sm text-text-2">Race a synthetic opponent right now</span>
          </button>
          <button
            type="button"
            className={DOOR_CARD_CLASS}
            onClick={() => {
              setDoor({ kind: 'human-level' })
            }}
          >
            <span className="text-lg font-bold">Play Human</span>
            <span className="text-sm text-text-2">
              Solve 5 puzzles, then send the link to a friend
            </span>
          </button>
        </div>
      )}
      {door.kind !== 'menu' && (
        <p className="text-text-1">
          Coming in a later task —{' '}
          <button
            type="button"
            className="text-accent bg-transparent border-0 cursor-pointer p-0 font-bold"
            onClick={() => {
              setDoor({ kind: 'menu' })
            }}
          >
            back
          </button>
          .
        </p>
      )}
    </div>
  )
}
