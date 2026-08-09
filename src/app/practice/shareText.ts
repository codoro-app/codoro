/**
 * Clipboard share text for a solved/attempted Practice puzzle — same
 * mechanism as Daily's buildShareText (src/app/daily/shareText.ts) and
 * Rush's buildRushShareText (src/app/rush/shareText.ts), a separate
 * template function per the existing per-mode duplication convention
 * (locked, v2 Phase 1b build plan) rather than unifying all three. No
 * day number or streak here — Practice is continuous, not a fixed daily
 * puzzle — so the shareable fact is simply "I attempted this puzzle" plus
 * its outcome and a link back to it.
 */
import { buildChallengePayload, buildChallengeUrl, truncateToChallengeLimit } from '../../challenge'
import type { ChallengeAttemptInput } from '../../challenge'

export interface PracticeShareTextInput {
  puzzleId: string
  correct: boolean
}

const SITE_URL = 'getcodoro.com'

export function buildPracticeShareText({ puzzleId, correct }: PracticeShareTextInput): string {
  const resultLine = correct ? '✅ solved it' : '❌ missed it'
  return `Codoro Practice — ${resultLine} — ${SITE_URL}/puzzle/${puzzleId}`
}

/**
 * Clipboard challenge-link text for the live Practice streak (v2 Phase 5c) —
 * a /challenge link replaying the current streak's correct answers. The
 * "N in a row" headline counts the puzzles actually encoded
 * (truncateToChallengeLimit's last MAX_CHALLENGE_PUZZLES), never the raw
 * streak, so the pitch can't overstate a link that plays a shorter tail.
 */
export interface PracticeChallengeTextInput {
  /** The live streak's correct answers, in play order — buildChallengePayload keeps the last MAX_CHALLENGE_PUZZLES. */
  attempts: readonly ChallengeAttemptInput[]
}

export function buildPracticeChallengeText({ attempts }: PracticeChallengeTextInput): string {
  const encodedCount = truncateToChallengeLimit([...attempts]).length
  return `Beat my Codoro Practice streak — ${String(encodedCount)} in a row — ${buildChallengeUrl(
    buildChallengePayload([...attempts]),
  )}`
}
