/**
 * Wordle-style clipboard share text for a completed Daily puzzle. Pure
 * formatting only — puzzle content (prompt/explanation/snippet) never enters
 * this function, so "no spoilers" holds by construction, not by convention.
 * Treat this format as a public API once shipped — the build plan expects
 * users to screenshot it.
 */
export interface ShareTextInput {
  dayNumber: number
  /** Whether the day's rated (first) attempt was correct — retries never change this, see useDailySession. */
  correct: boolean
  streak: number
}

const SITE_URL = 'getcodoro.com'

export function buildShareText({ dayNumber, correct, streak }: ShareTextInput): string {
  const resultLine = correct ? '✅ first try' : '❌ missed it'
  return `Codoro Daily #${String(dayNumber)} — ${resultLine} — 🔥 ${String(streak)}-day streak — ${SITE_URL}`
}
