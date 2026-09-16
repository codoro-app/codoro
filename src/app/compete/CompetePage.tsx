/**
 * `/compete` — a new, purely-additive multiplayer entry point: two doors
 * into the exact same `/challenge` run the app already has on the
 * recipient's side. "Play Computer" synthesizes both the puzzle set and the
 * opponent's results from a target rating and races them immediately, via
 * `buildComputerChallengePayload` (src/challenge/computerOpponent.ts) fed
 * straight into `useChallengeSessionForPayload` — no URL round-trip, since
 * nothing about a synthetic run needs to be shareable (see
 * useChallengeSession.ts's own doc comment for why). "Play Human" (a later
 * task) draws the same way but has the initiator generate the results by
 * actually solving the 5 puzzles, then hands the result to the existing,
 * unmodified `ChallengeButton`.
 */
import { useState } from 'react'
import { buildComputerChallengePayload } from '../../challenge'
import type { ChallengePayload, EloTier } from '../../challenge'
import { puzzleMeta } from '../../content'
import { trackChallengeCreate } from '../../telemetry'
import { useChallengeSessionForPayload } from '../challenge/useChallengeSession'
import { ChallengePageForSession } from '../challenge/ChallengePage'
import { LevelPicker } from './LevelPicker'

const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[var(--space-4)] px-4 pb-4'

const DOOR_CARD_CLASS =
  'flex flex-col items-start gap-2 min-h-11 w-full p-5 rounded-md border border-accent bg-surface-1 text-left text-text-0 cursor-pointer lg:transition-[transform,border-color] lg:duration-150 lg:hover:-translate-y-0.5 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

// Same {id, rating} adapter usePracticeSession.ts's own toEnginePuzzle uses.
const ENGINE_POOL = puzzleMeta.map((meta) => ({ id: meta.id, rating: meta.difficulty_rating }))

type Door =
  | { kind: 'menu' }
  | { kind: 'computer-level' }
  | { kind: 'computer-race'; payload: ChallengePayload }
  | { kind: 'human-level' }

function ComputerRaceView({ payload }: { payload: ChallengePayload }) {
  const session = useChallengeSessionForPayload(payload, 'computer')
  return <ChallengePageForSession session={session} />
}

export function CompetePage() {
  const [door, setDoor] = useState<Door>({ kind: 'menu' })

  function handleSelectComputerTier(tier: EloTier) {
    const payload = buildComputerChallengePayload(tier, ENGINE_POOL, Math.random)
    trackChallengeCreate({ surface: 'computer', puzzle_count: payload.ids.length })
    setDoor({ kind: 'computer-race', payload })
  }

  return (
    <div className={PAGE_SHELL_CLASS}>
      {door.kind !== 'computer-race' && (
        <p className="m-0 text-xl font-bold text-text-0">Compete</p>
      )}
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
      {door.kind === 'computer-level' && (
        <LevelPicker
          onSelect={handleSelectComputerTier}
          onBack={() => {
            setDoor({ kind: 'menu' })
          }}
        />
      )}
      {door.kind === 'computer-race' && <ComputerRaceView payload={door.payload} />}
      {door.kind === 'human-level' && (
        <p className="text-text-1">
          Play Human lands in a later task —{' '}
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
