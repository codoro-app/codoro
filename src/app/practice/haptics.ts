/**
 * A short haptic "tick" fired on answer commit — Android Chrome/Firefox
 * expose `navigator.vibrate`; iOS Safari never defines the method at all, so
 * the `'vibrate' in navigator` feature-detect alone handles that platform
 * split without any UA sniffing. Some browsers instead throw under certain
 * permission policies rather than simply omitting the method, so the call
 * itself is wrapped in try/catch too — either way, a missing/blocked haptic
 * must never break the answer-commit flow.
 */
import type { Outcome } from './feel'

export const HAPTIC_TICK_MS = 15

export function hapticTick(): void {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(HAPTIC_TICK_MS)
    } catch {
      // Degrade silently — haptic feedback is a nice-to-have, never load-bearing.
    }
  }
}

/** One vibration pattern per outcome — see docs/design/practice-feedback-loop.md §5 for the full rationale (escalating with impact level, a distinct "caught" pattern for shielded). */
function patternFor(outcome: Outcome): number | number[] {
  if (outcome.kind === 'wrong') return 40
  if (outcome.kind === 'shielded') return [10, 60, 10]
  if (outcome.level >= 3) return [12, 30, 18, 30, 26]
  if (outcome.level === 2) return [12, 40, 18]
  return HAPTIC_TICK_MS
}

/** Same feature-detect + try/catch posture as hapticTick above — a missing/blocked haptic must never break the commit path. */
export function hapticImpact(outcome: Outcome): void {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(patternFor(outcome))
    } catch {
      // Degrade silently — haptic feedback is a nice-to-have, never load-bearing.
    }
  }
}
