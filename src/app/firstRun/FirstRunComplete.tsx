/**
 * The first-run sequence's payoff screen — rendered by `FirstRunSequence`
 * once `useFirstRunSession`'s `phase === 'ended'` (all 3 curated puzzles
 * answered). Per the design doc: a real stat, not "nice job" (the player's
 * new rating + `{correct_count}/3`, mirroring how BossPage's/DailyPage's own
 * end-of-run hero always leads with a real number), a primary CTA into
 * `/practice` and a secondary link into `/daily`, and — the whole point of
 * shipping this alongside the challenge redesign — the same first-class,
 * always-visible `ChallengeButton` every other surface now uses, fed this
 * run's 3 puzzle results and `surface: 'first_run'`. No bespoke challenge
 * affordance invented for this one screen.
 *
 * Styling mirrors BossPage's/DailyPage's `.daily-hero`-style gradient hero
 * (`CARD_PRIMARY`'s treatment in Home.tsx) verbatim — no new visual language.
 *
 * `onExit` fires when the player taps either CTA — both are real `<Link>`
 * navigations (unmounting Home in the real app the instant the route
 * changes), but `onExit` still fires first so `Home`'s own local `profile`/
 * `showFirstRun` state is synced immediately rather than depending on a full
 * remount to notice the persisted `firstRunCompleted: true` — the same
 * "falls through to normal Home content with no reload" contract the design
 * doc's gate section describes. Deliberately NOT fired automatically the
 * instant `phase` becomes `'ended'`: `Home`'s `showFirstRun` is real state,
 * not a value re-derived every render, precisely so this payoff screen stays
 * mounted and visible until the player actually chooses to leave it — an
 * automatic fire-on-`'ended'` call would flip `showFirstRun` to false and
 * unmount this screen before the player ever saw it.
 */
import { Link } from 'wouter'
import type { UserProfile } from '../../storage'
import type { ChallengeAttemptInput } from '../../challenge'
import { ChallengeButton } from '../ChallengeButton'
import { ROUTES } from '../routes'
import { PracticeIcon } from '../Icons'

export interface FirstRunCompleteProps {
  profile: UserProfile
  correctCount: number
  totalPuzzles: number
  runAttempts: readonly ChallengeAttemptInput[]
  challengerName: string | null
  onNameNeeded: (name: string) => Promise<void>
  onExit: () => void
}

const HERO_CLASS =
  'flex flex-col gap-4 p-4 lg:py-[28px] lg:px-[30px] rounded-xl border-[1.5px] border-accent [background:linear-gradient(160deg,var(--accent-dim),var(--surface-1))]'

const PRIMARY_CTA_CLASS =
  'flex items-center justify-center min-h-11 py-3 px-4 rounded-md border-0 bg-accent text-accent-ink text-base font-bold text-center no-underline cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

const SECONDARY_CTA_CLASS =
  'flex items-center justify-center min-h-11 py-2 px-3 border-0 bg-transparent text-accent text-md font-semibold text-center no-underline cursor-pointer'

export function FirstRunComplete({
  profile,
  correctCount,
  totalPuzzles,
  runAttempts,
  challengerName,
  onNameNeeded,
  onExit,
}: FirstRunCompleteProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className={HERO_CLASS}>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center shrink-0 w-11 h-11 rounded-md bg-accent"
            aria-hidden="true"
          >
            <PracticeIcon size={22} />
          </div>
          <div className="flex flex-col gap-1">
            <p className="m-0 text-lg font-bold text-text-0">You solved your first puzzles</p>
            <p className="m-0 text-sm text-text-1">
              {correctCount}/{totalPuzzles} correct
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col items-center gap-1 p-3 rounded-md bg-surface-0 border border-border">
            <span className="text-lg font-bold text-text-0">{Math.round(profile.rating)}</span>
            <span className="text-xs text-text-2">Rating</span>
          </div>
          <div className="flex flex-col items-center gap-1 p-3 rounded-md bg-surface-0 border border-border">
            <span className="text-lg font-bold text-text-0">
              {correctCount}/{totalPuzzles}
            </span>
            <span className="text-xs text-text-2">Correct</span>
          </div>
        </div>
      </div>

      <ChallengeButton
        attempts={runAttempts}
        surface="first_run"
        introLabel="beat my first Codoro run"
        challengerName={challengerName}
        onNameNeeded={onNameNeeded}
      />

      <Link href={ROUTES.practice.path} className={PRIMARY_CTA_CLASS} onClick={onExit}>
        Keep practicing
      </Link>
      <Link href={ROUTES.daily.path} className={SECONDARY_CTA_CLASS} onClick={onExit}>
        Try today&apos;s Daily instead
      </Link>
    </div>
  )
}
