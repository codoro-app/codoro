/**
 * A short haptic "tick" fired on answer commit — Android Chrome/Firefox
 * expose `navigator.vibrate`; iOS Safari never defines the method at all, so
 * the `'vibrate' in navigator` feature-detect alone handles that platform
 * split without any UA sniffing. Some browsers instead throw under certain
 * permission policies rather than simply omitting the method, so the call
 * itself is wrapped in try/catch too — either way, a missing/blocked haptic
 * must never break the answer-commit flow.
 */
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
