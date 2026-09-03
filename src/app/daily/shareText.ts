/**
 * Wordle-style clipboard share text for a completed Daily puzzle. Pure
 * formatting only — puzzle content (prompt/explanation/snippet) never enters
 * this function, so "no spoilers" holds by construction, not by convention.
 * Treat this format as a public API once shipped — the build plan expects
 * users to screenshot it.
 *
 * The day's challenge link used to have its own template function here
 * (`buildDailyChallengeText`) — removed by the challenge redesign, which
 * replaced every surface's bespoke challenge-text builder with the shared
 * `ChallengeButton` component (src/app/ChallengeButton.tsx). This file now
 * only covers the plain, non-challenge Wordle-style result text.
 */
export interface ShareTextInput {
  dayNumber: number
  /** Whether the day's rated (first) attempt was correct — retries never change this, see useDailySession. */
  correct: boolean
  streak: number
  /** Today's puzzle id — links the shared text to its real, playable /puzzle/:id page (v2 Phase 1b) instead of the bare site root. Still no spoiler: the id alone reveals nothing about the puzzle's content. */
  puzzleId: string
}

const SITE_URL = 'getcodoro.com'

export function buildShareText({ dayNumber, correct, streak, puzzleId }: ShareTextInput): string {
  const resultLine = correct ? '✅ first try' : '❌ missed it'
  return `Codoro Daily #${String(dayNumber)} — ${resultLine} — 🔥 ${String(streak)}-day streak — ${SITE_URL}/puzzle/${puzzleId}`
}
