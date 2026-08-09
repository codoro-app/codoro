/**
 * Clipboard share text for a completed Rush run — same mechanism as Daily's
 * buildShareText (src/app/daily/shareText.ts), a separate template function
 * since the two modes' shareable stats differ (day number + first-try
 * result + streak vs. solved count + in-run best streak). No spoiler
 * concern here (Rush has no single "the puzzle" to protect), so the copy
 * stays punchy. Exact wording is Thomas's to tweak — this is the one
 * obvious place to do it.
 */
import { buildChallengePayload, buildChallengeUrl } from '../../challenge'
import type { ChallengeAttemptInput } from '../../challenge'

export interface RushShareTextInput {
  solvedCount: number
  bestStreakThisRun: number
  /** The run's last-served puzzle id — the one that ended it — links the shared text to its real, playable /puzzle/:id page (v2 Phase 1b) instead of the bare site root. */
  puzzleId: string
}

const SITE_URL = 'getcodoro.com'

export function buildRushShareText({
  solvedCount,
  bestStreakThisRun,
  puzzleId,
}: RushShareTextInput): string {
  return `Codoro Rush — ${String(solvedCount)} solved · 🔥 best ${String(bestStreakThisRun)} — ${SITE_URL}/puzzle/${puzzleId}`
}

/**
 * Clipboard challenge-link text for a finished Rush run (v2 Phase 5c) —
 * the run's headline stats plus a /challenge link replaying the run. Built
 * on the challenge domain's own codec (src/challenge): buildChallengePayload
 * truncates a longer run to its last MAX_CHALLENGE_PUZZLES puzzles, so the
 * encoded link always matches what the recipient actually plays even when
 * the headline counts the full run.
 */
export interface RushChallengeTextInput {
  solvedCount: number
  bestStreakThisRun: number
  /** The finished run's attempts, in play order — buildChallengePayload keeps the last MAX_CHALLENGE_PUZZLES. */
  attempts: readonly ChallengeAttemptInput[]
}

export function buildRushChallengeText({
  solvedCount,
  bestStreakThisRun,
  attempts,
}: RushChallengeTextInput): string {
  return `Beat my Codoro Rush — ${String(solvedCount)} solved · 🔥 best ${String(
    bestStreakThisRun,
  )} — ${buildChallengeUrl(buildChallengePayload([...attempts]))}`
}
