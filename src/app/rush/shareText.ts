/**
 * Clipboard share text for a completed Rush run — same mechanism as Daily's
 * buildShareText (src/app/daily/shareText.ts), a separate template function
 * since the two modes' shareable stats differ (day number + first-try
 * result + streak vs. solved count + in-run best streak). No spoiler
 * concern here (Rush has no single "the puzzle" to protect), so the copy
 * stays punchy. Exact wording is Thomas's to tweak — this is the one
 * obvious place to do it.
 *
 * The run's challenge link used to have its own template function here
 * (`buildRushChallengeText`) — removed by the challenge redesign, which
 * replaced every surface's bespoke challenge-text builder with the shared
 * `ChallengeButton` component (src/app/ChallengeButton.tsx). This file now
 * only covers the plain, non-challenge "Share puzzle" result text.
 */
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
