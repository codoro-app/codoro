/**
 * Minimal hover/focus/tap tooltip — Phase 4.4 (todo 12): there was no
 * tooltip anywhere in the codebase before this. Built in-house rather than
 * pulling in a runtime dependency (bundle-discipline decision,
 * docs/v4-build-plan.md's Phase 4.4) — deliberately small: one
 * absolutely-positioned bubble, no portal, no popper-style collision engine
 * beyond a single top/bottom flip near the viewport's top edge.
 *
 * Wraps the trigger in a relatively-positioned `<span>` rather than cloning
 * hover/focus handlers onto the child — the trigger keeps its own
 * onClick/disabled/etc. completely untouched. Only `aria-describedby` is
 * added to the trigger itself (merged with any it already carries), since
 * that has to live on the element it describes to mean anything to
 * assistive tech. mouseenter/mouseleave don't bubble, but they fire
 * directly on the wrapper regardless — it hugs the trigger's own box via
 * `inline-flex`, so entering/leaving the trigger IS entering/leaving the
 * wrapper. React normalizes focus/blur to bubble, so those work the same
 * way without any special-casing.
 *
 * Desktop: hover shows the bubble after a short delay (avoids flicker on a
 * fast mouse-through); keyboard focus shows it immediately, no delay — a
 * keyboard user tabbing through controls shouldn't have to wait to find out
 * what one does. Escape, blur, or the pointer leaving all hide it.
 *
 * Touch: a tap shows the bubble immediately and it auto-dismisses on its
 * own shortly after — the tap's normal action (onClick) still fires
 * untouched. Blocking the first tap until a second one "confirms" it would
 * make frequently-tapped controls (Scrubber's step buttons, in particular)
 * feel broken under fast repeated tapping; showing the label alongside the
 * action still satisfies "reachable on touch" without that cost.
 *
 * The bubble stays mounted at all times, hidden via opacity/scale (not
 * display/visibility) — specifically so `aria-describedby` keeps resolving
 * to real content for assistive tech regardless of the CSS-visible state,
 * and so the show transition has something already in the DOM to animate.
 */
import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from 'react'

export interface TooltipProps {
  label: string
  children: ReactElement<{ 'aria-describedby'?: string }>
  /** Merged onto the wrapper `<span>` — for layout concerns the trigger's own className used to carry (e.g. `shrink-0` inside a flex row) that now belong on the wrapper instead, since it's the actual flex item. */
  className?: string
}

const HOVER_DELAY_MS = 400
const TOUCH_DISMISS_MS = 1600
// Below this many px from the viewport top, a bubble opening "above" the
// trigger wouldn't fit — flip it below instead. A rough margin (bubble
// height + gap + breathing room), not measured per-instance: precision
// doesn't matter here, only keeping the bubble from clipping off-screen.
const FLIP_THRESHOLD_PX = 56

function withDescribedBy(
  child: ReactElement<{ 'aria-describedby'?: string }>,
  describedById: string,
): ReactElement {
  if (!isValidElement(child)) return child
  const existing = child.props['aria-describedby']
  return cloneElement(child, {
    'aria-describedby': existing ? `${existing} ${describedById}` : describedById,
  })
}

export function Tooltip({ label, children, className }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top')
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const hoverTimer = useRef<number | undefined>(undefined)
  const dismissTimer = useRef<number | undefined>(undefined)
  const tooltipId = useId()

  // Belt-and-braces cleanup on unmount — every path that sets a timer also
  // clears it on its own, but a trigger unmounting mid-delay (e.g. Scrubber
  // swapping puzzles under a still-hovered button) would otherwise fire
  // `reveal`/`hide` against a detached component.
  useEffect(
    () => () => {
      window.clearTimeout(hoverTimer.current)
      window.clearTimeout(dismissTimer.current)
    },
    [],
  )

  function reveal() {
    const rect = wrapperRef.current?.getBoundingClientRect()
    setPlacement(rect && rect.top < FLIP_THRESHOLD_PX ? 'bottom' : 'top')
    setOpen(true)
  }

  function hide() {
    window.clearTimeout(hoverTimer.current)
    window.clearTimeout(dismissTimer.current)
    setOpen(false)
  }

  function handleMouseEnter() {
    hoverTimer.current = window.setTimeout(reveal, HOVER_DELAY_MS)
  }

  function handleMouseLeave() {
    window.clearTimeout(hoverTimer.current)
    hide()
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.pointerType !== 'touch') return
    reveal()
    window.clearTimeout(dismissTimer.current)
    dismissTimer.current = window.setTimeout(hide, TOUCH_DISMISS_MS)
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLSpanElement>) {
    if (event.key === 'Escape' && open) hide()
  }

  return (
    <span
      ref={wrapperRef}
      className={className ? `relative inline-flex ${className}` : 'relative inline-flex'}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={reveal}
      onBlur={hide}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    >
      {withDescribedBy(children, tooltipId)}
      <span
        role="tooltip"
        id={tooltipId}
        className={[
          'pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-sm border border-border bg-surface-2 px-2 py-1 text-xs font-semibold text-text-0 shadow-lg transition-[opacity,transform] duration-150 ease-out',
          placement === 'top' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]',
          open ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
        ].join(' ')}
      >
        {label}
      </span>
    </span>
  )
}
