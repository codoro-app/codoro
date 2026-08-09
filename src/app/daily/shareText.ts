/**
 * Wordle-style clipboard share text for a completed Daily puzzle. Pure
 * formatting only — puzzle content (prompt/explanation/snippet) never enters
 * this function, so "no spoilers" holds by construction, not by convention.
 * Treat this format as a public API once shipped — the build plan expects
 * users to screenshot it.
 */
import { buildChallengePayload, buildChallengeUrl } from '../../challenge'
import type { ChallengeAttemptInput } from '../../challenge'

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

/**
 * Clipboard challenge-link text for the day's first attempt (v2 Phase 5c) —
 * the same copy mechanism as buildShareText, but the copied artifact is a
 * /challenge link replaying the attempt rather than share text. Built on the
 * challenge domain's own codec (src/challenge) so the URL can never drift
 * from what the link actually replays — encode is the single source of
 * truth for both. Shares buildShareText's "no spoilers" property: the
 * payload encodes the puzzle id and outcome, not its content.
 */
export interface DailyChallengeTextInput {
  dayNumber: number
  /** The day's first (rated) attempt — the challenge link replays this exact puzzle. Never a retry (see useDailySession). */
  attempt: ChallengeAttemptInput
}

export function buildDailyChallengeText({ dayNumber, attempt }: DailyChallengeTextInput): string {
  return `Beat my Codoro Daily #${String(dayNumber)} — ${buildChallengeUrl(
    buildChallengePayload([attempt]),
  )}`
}
