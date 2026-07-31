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
export interface PracticeShareTextInput {
  puzzleId: string
  correct: boolean
}

const SITE_URL = 'getcodoro.com'

export function buildPracticeShareText({ puzzleId, correct }: PracticeShareTextInput): string {
  const resultLine = correct ? '✅ solved it' : '❌ missed it'
  return `Codoro Practice — ${resultLine} — ${SITE_URL}/puzzle/${puzzleId}`
}
