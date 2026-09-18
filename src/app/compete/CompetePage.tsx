/**
 * `/compete` — a new, purely-additive multiplayer entry point: two doors
 * into the exact same `/challenge` run the app already has on the
 * recipient's side. "Play Computer" synthesizes both the puzzle set and the
 * opponent's results from a target rating and races them immediately, via
 * `buildComputerChallengePayload` fed straight into
 * `useChallengeSessionForPayload` — no URL round-trip. "Play Human" draws
 * the same 5-puzzle set the same way but has the initiator generate the
 * results by actually solving them (`useCompeteSession`), then hands the
 * result to the existing, unmodified `ChallengeButton` (`surface:
 * 'compete'`) for a real 1-on-1 share link. Same draw step
 * (`widenedEligible` + `sampleDistinctIds`), same downstream consumer
 * (`/challenge`'s intro/ghost-race/comparison UI on the recipient's side),
 * different only in how `results` gets filled in.
 */
import { useEffect, useState } from 'react'
import {
  buildComputerChallengePayload,
  sampleDistinctIds,
  MAX_CHALLENGE_PUZZLES,
  TIER_TARGET_RATING,
} from '../../challenge'
import type { ChallengeAttemptInput, ChallengePayload, EloTier } from '../../challenge'
import { widenedEligible } from '../../engine'
import { puzzleMeta } from '../../content'
import { trackChallengeCreate, trackError } from '../../telemetry'
import { loadProfile, saveProfile } from '../../storage'
import type { UserProfile } from '../../storage'
import { useChallengeSessionForPayload } from '../challenge/useChallengeSession'
import { ChallengePageForSession, QUIT_BUTTON_CLASS } from '../challenge/ChallengePage'
import { ChallengeButton } from '../ChallengeButton'
import { useChallengerName } from '../useChallengerName'
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { TraceRunnerPuzzle } from '../trace/TraceRunner'
import { CloseIcon, CompeteIcon, MonitorIcon, PeopleIcon } from '../Icons'
import { LevelPicker } from './LevelPicker'
import { useCompeteSession } from './useCompeteSession'

// Layout-shell centering (redesign, 2026-09-17) was tried here and reverted
// 2026-09-18: CENTERED_PAGE_SHELL_CLASS's `lg:self-stretch` fills the
// entire viewport-height column on desktop, and `justify-center` then
// dead-centers this page's content within it — live-confirmed (in-browser,
// same symptom reported on Rush and Trace) that this reads as the content
// "sitting lower" on screen, not as the fixed dead-space problem it was
// meant to solve: total empty space is unchanged, just redistributed above
// the content instead of below it. Back to the plain top-anchored shell,
// matching every other page.
const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[var(--space-4)] px-4 pb-4'

// border-border, not border-accent: the redesign mockups (docs/redesign/
// mockups/Compete*.png) show a plain neutral border on both door cards, not
// a lime accent border. lg:flex-1 (paired with the menu's own lg:flex-row
// wrapper below) is what lays the two cards side-by-side on desktop.
const DOOR_CARD_CLASS =
  'flex flex-col items-start gap-2 min-h-11 w-full lg:flex-1 p-5 rounded-md border border-border bg-surface-1 text-left text-text-0 cursor-pointer lg:transition-[transform,border-color] lg:duration-150 lg:hover:-translate-y-0.5 lg:hover:border-border-strong active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

const ICON_BADGE_CLASS =
  'flex items-center justify-center flex-none w-10 h-10 rounded-md bg-accent-dim text-accent'

// Same {id, rating} adapter usePracticeSession.ts's own toEnginePuzzle uses.
const ENGINE_POOL = puzzleMeta.map((meta) => ({ id: meta.id, rating: meta.difficulty_rating }))

type Door =
  | { kind: 'menu' }
  | { kind: 'computer-level' }
  | { kind: 'computer-race'; payload: ChallengePayload }
  | { kind: 'human-level' }
  | { kind: 'human-play'; ids: readonly string[] }

function ComputerRaceView({ payload, onQuit }: { payload: ChallengePayload; onQuit: () => void }) {
  const session = useChallengeSessionForPayload(payload, 'computer')
  return <ChallengePageForSession session={session} onQuit={onQuit} />
}

/** End-of-run screen for Play Human's initiator — the only new place this pass reads/writes a profile, and only for `challengerName` (same scope ChallengeComparison.tsx's own counter-challenge CTA already has). */
function CompeteHumanDone({ attempts }: { attempts: readonly ChallengeAttemptInput[] }) {
  const [profile, setProfileState] = useState<UserProfile | null>(null)
  useEffect(() => {
    let cancelled = false
    loadProfile()
      .then((loaded) => {
        if (!cancelled) setProfileState(loaded)
      })
      .catch((error: unknown) => {
        trackError(error, 'CompeteHumanDone: loadProfile failed')
      })
    return () => {
      cancelled = true
    }
  }, [])
  const challenger = useChallengerName(profile, async (updated) => {
    setProfileState(updated)
    await saveProfile(updated)
  })

  const correct = attempts.filter((a) => a.correct).length
  const totalMs = attempts.reduce((sum, a) => sum + a.time_ms, 0)

  return (
    <div className="flex flex-col gap-3 text-center py-4">
      <p className="text-text-1 font-bold text-[1.125rem] m-0">Your 5 puzzles are ready to share</p>
      <p className="text-text-2 m-0">
        You got {correct}/{attempts.length} in {Math.round(totalMs / 1000)}s
      </p>
      <div className="flex flex-wrap gap-3 justify-center mt-2">
        <ChallengeButton
          attempts={attempts}
          surface="compete"
          introLabel="beat my puzzle set"
          challengerName={challenger.name}
          onNameNeeded={challenger.setName}
        />
      </div>
    </div>
  )
}

function HumanPlayView({ ids, onQuit }: { ids: readonly string[]; onQuit: () => void }) {
  const session = useCompeteSession(ids)

  if (session.status === 'loading') {
    return <p className="text-center text-text-1 py-8">Loading puzzles…</p>
  }
  if (session.status === 'done') {
    return <CompeteHumanDone attempts={session.results} />
  }
  const puzzle = session.puzzle
  if (!puzzle) return null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-sm font-bold text-text-1">
          Puzzle {session.puzzleIndex + 1} of {session.totalPuzzles}
        </p>
        <button type="button" className={QUIT_BUTTON_CLASS} onClick={onQuit}>
          <CloseIcon size={12} />
          Quit
        </button>
      </div>
      {puzzle.interaction === 'scrubber' ? (
        <TraceRunnerPuzzle
          key={session.puzzleIndex}
          puzzle={puzzle}
          checkpointResults={session.checkpointResults}
          isComplete={session.isComplete}
          solved={session.solved}
          ratingDelta={null}
          onCheckpointAnswered={session.handleCheckpointAnswered}
          onContinue={session.handleContinue}
          timed={false}
          sidebarSlot={null}
        />
      ) : (
        <PuzzleCardShell
          key={session.puzzleIndex}
          puzzle={puzzle}
          ratingDelta={null}
          onAnswered={session.handleAnswered}
          onContinue={session.handleContinue}
          sidebarSlot={null}
        />
      )}
    </div>
  )
}

export function CompetePage() {
  const [door, setDoor] = useState<Door>({ kind: 'menu' })

  function handleSelectComputerTier(tier: EloTier) {
    const payload = buildComputerChallengePayload(tier, ENGINE_POOL, Math.random)
    trackChallengeCreate({ surface: 'computer', puzzle_count: payload.ids.length })
    setDoor({ kind: 'computer-race', payload })
  }

  function handleSelectHumanTier(tier: EloTier) {
    const eligible = widenedEligible(ENGINE_POOL, TIER_TARGET_RATING[tier])
    const ids = sampleDistinctIds(eligible, MAX_CHALLENGE_PUZZLES, Math.random).map((p) => p.id)
    setDoor({ kind: 'human-play', ids })
  }

  const showHeading = door.kind === 'computer-level' || door.kind === 'human-level'

  return (
    <div className={PAGE_SHELL_CLASS}>
      {showHeading && <p className="m-0 text-xl font-bold text-text-0">Compete</p>}
      {door.kind === 'menu' && (
        <div className="flex flex-col items-center gap-6 w-full">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="text-accent">
              <CompeteIcon size={32} />
            </span>
            <p className="m-0 text-2xl font-bold text-text-0">Compete</p>
          </div>
          <div className="flex flex-col gap-3 w-full lg:flex-row lg:gap-4">
            <button
              type="button"
              className={DOOR_CARD_CLASS}
              onClick={() => {
                setDoor({ kind: 'computer-level' })
              }}
            >
              <span className={ICON_BADGE_CLASS}>
                <MonitorIcon size={20} />
              </span>
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
              <span className={ICON_BADGE_CLASS}>
                <PeopleIcon size={20} />
              </span>
              <span className="text-lg font-bold">Play Human</span>
              <span className="text-sm text-text-2">
                Solve 5 puzzles, then send the link to a friend
              </span>
            </button>
          </div>
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
      {door.kind === 'computer-race' && (
        <ComputerRaceView
          payload={door.payload}
          onQuit={() => {
            setDoor({ kind: 'menu' })
          }}
        />
      )}
      {door.kind === 'human-level' && (
        <LevelPicker
          onSelect={handleSelectHumanTier}
          onBack={() => {
            setDoor({ kind: 'menu' })
          }}
        />
      )}
      {door.kind === 'human-play' && (
        <HumanPlayView
          ids={door.ids}
          onQuit={() => {
            setDoor({ kind: 'menu' })
          }}
        />
      )}
    </div>
  )
}
