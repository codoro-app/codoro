/**
 * Shared rAF number tween — the "the number must visibly move" half of the
 * practice feedback loop's motion spec (docs/design/practice-feedback-loop.md
 * section 7): FeedbackHeader's promoted rating delta counts up from 0 on
 * each fresh commit (`animateOnMount: true` — it mounts fresh per commit),
 * and StatusBar's rating pill tweens from its old value to its new one
 * whenever the profile's rating changes but never animates in on first
 * page load (default: snap to target on mount, animate only on change).
 */
import { useEffect, useRef, useState } from 'react'

export function useNumberTween(
  target: number,
  durationMs: number,
  options?: { animateOnMount?: boolean },
): number {
  const animateOnMount = options?.animateOnMount ?? false
  const [displayed, setDisplayed] = useState(animateOnMount ? 0 : target)
  const displayedRef = useRef(animateOnMount ? 0 : target)
  const hasMountedRef = useRef(false)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const from = displayedRef.current
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      if (!animateOnMount) {
        displayedRef.current = target
        return
      }
      // animateOnMount: fall through and animate from 0 (the initial
      // displayedRef value) to `target` below, same as any later change.
    }

    const delta = target - from
    if (delta === 0) return

    const start = performance.now()
    const tick = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(1, elapsed / durationMs)
      const next = from + delta * progress
      displayedRef.current = next
      setDisplayed(next)
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick)
      }
    }
    frameRef.current = requestAnimationFrame(tick)

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs])

  return displayed
}
