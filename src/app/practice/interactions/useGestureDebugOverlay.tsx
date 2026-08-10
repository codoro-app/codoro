import { useCallback, useRef, useState, type ReactNode } from 'react'

/**
 * TEMPORARY, DEV-ONLY — v3 Phase 0 instrumentation (docs/v3-build-plan.md,
 * Phase 0 build item 1), to be stripped or permanently flag-gated once OD-1
 * closes (Phase 0 build item 4).
 *
 * OD-1 (swipe unreliable on iPhone) survived five source-reading fix rounds,
 * so the v3 plan locks the method: capture the real pointer stream ON THE
 * FAILING DEVICE first, fix second. The device is a phone with no attached
 * devtools, so `console.log` is useless — this renders the log ON SCREEN.
 *
 * Activated only by `?gesture-debug=1` (matching PracticePage.tsx's
 * `new URLSearchParams(...).get(...)` convention for URL-driven behavior;
 * the repo's other dev-only surfaces gate on `import.meta.env.DEV`, which is
 * deliberately NOT used here — this has to run against a real production
 * build on the failing device, which is the only place the defect
 * reproduces). With the flag absent, `log()` is a no-op and `overlay` is
 * `null`: zero renders, zero allocations beyond the caller's own argument.
 *
 * Self-contained on purpose: inline styles, no CSS-file rule, one import and
 * three call sites in SwipeBinary.tsx. Deleting this file plus those call
 * sites removes the whole feature.
 */

/** How the gesture's axis has been resolved at the moment an event is logged (mirrors SwipeBinary's own `AxisResolution`). */
export type GestureDebugAxis = 'ambiguous' | 'horizontal' | 'vertical-yielded' | 'idle'

export interface GestureDebugEvent {
  readonly type: 'down' | 'move' | 'up' | 'cancel' | 'lostcapture'
  readonly x: number
  readonly y: number
  /**
   * The event's own `cancelable` flag — the single most load-bearing field
   * here. Once a browser has committed a touch to native scrolling it
   * dispatches subsequent events with `cancelable: false`, so a log line
   * reading `cancel=false` at the moment horizontal intent resolves is
   * direct evidence that the compositor won the race before JS could
   * `preventDefault()`.
   */
  readonly cancelable: boolean
  readonly axis: GestureDebugAxis
  /** Whether `preventDefault()` was actually called on THIS event. */
  readonly prevented: boolean
  /** Free-form tail — used on the final frame for the commit decision and the dx/velocity that produced it. */
  readonly note?: string | undefined
}

/** Newest-first ring buffer size: enough to hold a whole failing gesture, short enough to stay readable on a phone. */
const MAX_ENTRIES = 24

const FLAG_PARAM = 'gesture-debug'

function readFlag(): boolean {
  return new URLSearchParams(window.location.search).get(FLAG_PARAM) === '1'
}

function px(value: number): string {
  return String(Math.round(value))
}

function formatEntry(event: GestureDebugEvent, elapsedMs: number): string {
  const head = `+${px(elapsedMs)}ms ${event.type} x=${px(event.x)} y=${px(event.y)} cancelable=${String(event.cancelable)} axis=${event.axis} pd=${String(event.prevented)}`
  return event.note === undefined ? head : `${head} ${event.note}`
}

const containerStyle = {
  position: 'fixed',
  right: 0,
  bottom: 0,
  zIndex: 9999,
  maxHeight: '45vh',
  maxWidth: '100vw',
  overflowY: 'auto',
  padding: '4px 6px',
  background: 'rgba(0, 0, 0, 0.82)',
  color: '#8ef58e',
  font: '10px/1.35 ui-monospace, monospace',
  whiteSpace: 'pre',
  pointerEvents: 'none',
} as const

export interface GestureDebugOverlay {
  /** True when `?gesture-debug=1` was present at mount. */
  readonly enabled: boolean
  /** Records one pointer event. No-op unless enabled. */
  readonly log: (event: GestureDebugEvent) => void
  /** The on-screen log element, or `null` when disabled. */
  readonly overlay: ReactNode
}

export function useGestureDebugOverlay(): GestureDebugOverlay {
  // Read once, at mount: the flag can't change without a full navigation,
  // and re-reading per event would put a URL parse in the pointermove path.
  const [enabled] = useState(readFlag)
  const [originMs] = useState(() => performance.now())
  const [lines, setLines] = useState<readonly string[]>([])

  // v3 Phase 0, OD-4 candidate: a third on-device capture (post OD-2/OD-3)
  // showed every gesture — 4 of 4, all cleanly resolved horizontal with
  // preventDefault succeeding throughout — dying to a plain `pointercancel`
  // instead of the normal `pointerup` a finger-lift produces. The one thing
  // that changed once OD-2/OD-3 stopped killing gestures early: this
  // overlay's own `log()` call, which used to run `setLines` SYNCHRONOUSLY
  // inside the pointermove handler, forcing a full SwipeBinary re-render
  // (state update + reconciliation + up to MAX_ENTRIES DOM nodes) on every
  // single move sample during the drag — real work, on the main thread,
  // inside the touch dispatch path, and iOS Safari is documented to cancel
  // a touch it judges the page too slow to keep up with. Buffering into a
  // ref and flushing at most once per animation frame moves that render
  // cost off the synchronous touch-handling path entirely, to test that
  // hypothesis — the diagnostic instrument potentially breaking the thing
  // it exists to observe. See docs/v3-build-plan.md's amendment.
  const linesRef = useRef<string[]>([])
  const flushScheduledRef = useRef(false)

  const log = useCallback(
    (event: GestureDebugEvent) => {
      if (!enabled) return
      const line = formatEntry(event, performance.now() - originMs)
      linesRef.current = [line, ...linesRef.current].slice(0, MAX_ENTRIES)
      if (flushScheduledRef.current) return
      flushScheduledRef.current = true
      requestAnimationFrame(() => {
        flushScheduledRef.current = false
        setLines(linesRef.current)
      })
    },
    [enabled, originMs],
  )

  const overlay = enabled ? (
    <div style={containerStyle} aria-hidden="true" data-testid="gesture-debug-overlay">
      {/* Log lines have no stable identity and the list is append-at-head
          only (never reordered or edited), so position + content is the
          honest key. */}
      {lines.map((line, index) => (
        <div key={`${String(index)}:${line}`}>{line}</div>
      ))}
    </div>
  ) : null

  return { enabled, log, overlay }
}
