import { useLayoutEffect, useRef, useState } from 'react'
import { computeShrinkScale, DEFAULT_MIN_FONT_SCALE } from './autoShrinkFontScale'

export interface UseAutoShrinkFontScaleOptions {
  /**
   * CSS custom property set on the container element, consumed by the
   * caller's own `calc(var(--font-size-*) * var(<cssProperty>,1))` class —
   * kept per-consumer (not a single shared name) so each surface's scale is
   * distinguishable in devtools.
   */
  cssProperty: string
  /** Re-measure whenever any of these change (new content). */
  deps: readonly unknown[]
  minScale?: number
}

export interface UseAutoShrinkFontScaleResult {
  containerRef: React.RefObject<HTMLDivElement | null>
  fontScale: number
  scrollable: boolean
}

/**
 * Measures a container's widest line against its available width on mount
 * and on resize, shrinking its font (down to `minScale`) so content fits
 * without horizontal scroll where possible; content that still doesn't fit
 * at the floor keeps native horizontal scroll (`scrollable: true` — pair
 * with a visible scroll-affordance in the consumer's own markup/CSS, e.g.
 * CodeSnippet's `code-snippet--scrollable` right-edge fade).
 *
 * Extracted from CodeSnippet.tsx (the original, still primary consumer) so
 * Scrubber.tsx and DragOrder.tsx can apply the identical shrink-then-scroll
 * behavior instead of each reimplementing their own fixed-size, never-shrink
 * code-text rendering.
 */
export function useAutoShrinkFontScale({
  cssProperty,
  deps,
  minScale = DEFAULT_MIN_FONT_SCALE,
}: UseAutoShrinkFontScaleOptions): UseAutoShrinkFontScaleResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const [fontScale, setFontScale] = useState(1)
  const [scrollable, setScrollable] = useState(false)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    const measure = () => {
      // Reset to the unscaled baseline before measuring: scrollWidth scales
      // with the current font-size, so re-measuring without this would
      // compound a previous shrink (or under-correct after the container
      // grows, e.g. a viewport resize) instead of computing a fresh scale
      // from the real content width every time.
      el.style.setProperty(cssProperty, '1')
      const { scale, scrollable: needsScroll } = computeShrinkScale(
        el.scrollWidth,
        el.clientWidth,
        minScale,
      )
      el.style.setProperty(cssProperty, String(scale))
      setFontScale(scale)
      setScrollable(needsScroll)
    }

    measure()

    // Guarded for jsdom (no ResizeObserver) and any environment where it's
    // genuinely unavailable — the initial measure() above still runs either
    // way, so a missing observer just means no re-measure on resize.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { containerRef, fontScale, scrollable }
}
