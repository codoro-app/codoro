/**
 * Pure sizing math behind the shrink-to-fit behavior originally built into
 * `CodeSnippet.tsx`, extracted so `Scrubber.tsx` and `DragOrder.tsx` can
 * reuse the exact same computation instead of drifting from it (see
 * CodeSnippet.tsx's own doc comment for the original rationale: a long line
 * used to overflow with only a bare scrollbar as the affordance, invisible
 * on a thumb-driven quick glance).
 */

/**
 * Floor for the shrink below. Below this, text reads as illegible on a
 * 375px-wide card, so content that still doesn't fit at this scale falls
 * back to horizontal scroll instead of shrinking further.
 */
export const DEFAULT_MIN_FONT_SCALE = 0.7

export interface ShrinkResult {
  /** The font-size multiplier to apply, clamped to `minScale`. */
  scale: number
  /** True when shrinking to `minScale` still isn't enough to eliminate the overflow — the scroll affordance is still needed. */
  scrollable: boolean
}

/**
 * Given a measured `scrollWidth`/`clientWidth` pair (unscaled — see each
 * caller's own reset-before-measure step, needed because `scrollWidth`
 * scales with whatever font-size is already applied), returns the scale to
 * apply and whether the content still needs horizontal scroll at that
 * floor.
 */
export function computeShrinkScale(
  scrollWidth: number,
  clientWidth: number,
  minScale: number,
): ShrinkResult {
  const overflow = scrollWidth - clientWidth
  if (overflow <= 0) {
    return { scale: 1, scrollable: false }
  }
  // The scale that would exactly eliminate the overflow, before clamping to
  // the floor — used directly to decide `scrollable` rather than
  // re-measuring after applying the scale: a requiredScale at or above the
  // floor means shrinking fully fixed the fit (no scroll needed), one below
  // the floor means it can't be fully fixed by shrinking alone.
  const requiredScale = clientWidth / scrollWidth
  return {
    scale: Math.max(minScale, requiredScale),
    scrollable: requiredScale < minScale,
  }
}
