/**
 * Clipboard share text for a solved/attempted Practice puzzle — same
 * mechanism as Daily's buildShareText (src/app/daily/shareText.ts) and
 * Rush's buildRushShareText (src/app/rush/shareText.ts), a separate
 * template function per the existing per-mode duplication convention
 * (locked, v2 Phase 1b build plan) rather than unifying all three. No
 * day number or streak here — Practice is continuous, not a fixed daily
 * puzzle — so the shareable fact is simply "I attempted this puzzle" plus
 * its outcome and a link back to it.
 *
 * The Practice streak challenge link used to have its own template function
 * here (`buildPracticeChallengeText`) — removed by the challenge redesign,
 * which replaced every surface's bespoke challenge-text builder with the
 * shared `ChallengeButton` component (src/app/ChallengeButton.tsx), which
 * builds its own message from a caller-supplied `introLabel`. This file now
 * only covers the plain, non-challenge "Share puzzle" text.
 */
export interface PracticeShareTextInput {
  puzzleId: string
  correct: boolean
}

const SITE_URL = 'getcodoro.com'

export function buildPracticeShareText({ puzzleId, correct }: PracticeShareTextInput): string {
  const resultLine = correct ? '✅ solved it' : '❌ missed it'
  return `Codoro Practice — ${resultLine} — ${SITE_URL}/puzzle/${puzzleId}`
}
