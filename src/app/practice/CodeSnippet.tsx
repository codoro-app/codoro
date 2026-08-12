import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { HighlightedLine } from './highlightSnippet'
import type { AnswerState } from './answerState'

export interface CodeSnippetProps {
  lines: HighlightedLine[]
  /** When provided, each line renders as a tap target (TapLine's committed=false state). Omit (or pass undefined) for a static, read-only snippet. */
  onLineClick?: ((index: number) => void) | undefined
  /** Per-line visual state once committed (tap-line only). Defaults to 'default' for every line when omitted. */
  lineState?: ((index: number) => AnswerState) | undefined
}

/**
 * Floor for the auto-shrink below. Below this, text reads as illegible on a
 * 375px-wide card, so a snippet that still doesn't fit at this scale falls
 * back to horizontal scroll (with the `code-snippet--scrollable` right-edge
 * fade below) instead of shrinking further.
 */
const MIN_FONT_SCALE = 0.7

/**
 * Shared syntax-highlighted snippet renderer. PuzzleCardShell uses it
 * read-only for mcq puzzles; TapLine and SwipeBinary reuse it as their own
 * interactive/draggable surface.
 *
 * A long line (e.g. a Java generic type declaration) used to overflow the
 * card with only a bare horizontal scrollbar as the affordance — on a
 * thumb-driven, quick-glance interaction the bug-relevant trailing tokens
 * (closing generics, method args) were invisible without scrolling first.
 * This measures the widest line against the available width on mount and
 * on resize, shrinking the font (down to MIN_FONT_SCALE) so most snippets
 * fit without scrolling at all; a snippet that still doesn't fit at the
 * floor scale keeps native horizontal scroll but gets a visible
 * `code-snippet--scrollable` right-edge fade (practice.css) so the
 * affordance is obvious rather than a scrollbar easy to miss on a
 * quick glance.
 */
export function CodeSnippet({ lines, onLineClick, lineState }: CodeSnippetProps) {
  const interactive = onLineClick !== undefined
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
      el.style.setProperty('--code-snippet-font-scale', '1')
      const overflow = el.scrollWidth - el.clientWidth
      if (overflow <= 0) {
        el.style.setProperty('--code-snippet-font-scale', '1')
        setFontScale(1)
        setScrollable(false)
        return
      }
      // The scale that would exactly eliminate the overflow, before
      // clamping to the floor — used directly to decide `scrollable`
      // rather than re-reading scrollWidth after applying the scale: a
      // requiredScale at or above the floor means shrinking fully fixed
      // the fit (no scroll needed), one below the floor means it can't be
      // fully fixed by shrinking alone and the scroll affordance is still
      // needed.
      const requiredScale = el.clientWidth / el.scrollWidth
      const scale = Math.max(MIN_FONT_SCALE, requiredScale)
      el.style.setProperty('--code-snippet-font-scale', String(scale))
      setFontScale(scale)
      setScrollable(requiredScale < MIN_FONT_SCALE)
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
  }, [lines])

  // 2b.0: `code-snippet`/`code-snippet__line` stay literal (test-asserted —
  // CodeSnippet.test.tsx/PuzzleCardShell.test.tsx/TapLine.test.tsx all
  // select on them) and `code-snippet--scrollable` stays literal too (its
  // `::after` fade lives in practice.css, not expressible as a plain
  // utility class) — everything else here is Tailwind utilities.
  const className = [
    'code-snippet relative bg-surface-code border border-border rounded-md py-2.5 overflow-x-auto',
    "font-[ui-monospace,SFMono-Regular,Consolas,'Liberation_Mono',Menlo,monospace]",
    'text-[calc(var(--font-size-sm)*var(--code-snippet-font-scale,1))] leading-[1.5]',
    scrollable && 'code-snippet--scrollable',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ '--code-snippet-font-scale': fontScale } as CSSProperties}
    >
      {lines.map((line, index) => {
        const state = lineState?.(index) ?? 'default'
        // `code-snippet__line--<state>` markers stay literal alongside the
        // utilities — TapLine.test.tsx asserts on
        // `className.toContain('wrong'|'reveal-correct')`.
        const stateBg =
          state === 'wrong' ? 'bg-danger-dim' : state === 'reveal-correct' ? 'bg-ok-dim' : ''
        const lineClassName = [
          'code-snippet__line flex items-center gap-3 w-full py-px px-4 whitespace-pre text-left border-0 bg-transparent text-text-0 [font:inherit]',
          interactive &&
            'cursor-pointer min-h-11 hover:bg-surface-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2',
          state !== 'default' && `code-snippet__line--${state}`,
          stateBg,
        ]
          .filter(Boolean)
          .join(' ')

        const lineNumber = (
          <span
            className="code-snippet__line-number min-w-6 shrink-0 text-right text-text-2 select-none"
            aria-hidden="true"
          >
            {index + 1}
          </span>
        )
        const codeHtml = { __html: line.html || '&nbsp;' }

        if (interactive) {
          return (
            <button
              key={index}
              type="button"
              className={lineClassName}
              onClick={() => {
                onLineClick(index)
              }}
              aria-label={`Line ${String(index + 1)}: ${line.text.trim().length > 0 ? line.text : '(blank)'}`}
            >
              {lineNumber}
              <span
                className="code-snippet__line-code whitespace-pre"
                dangerouslySetInnerHTML={codeHtml}
              />
            </button>
          )
        }

        return (
          <div key={index} className={lineClassName}>
            {lineNumber}
            <span
              className="code-snippet__line-code whitespace-pre"
              dangerouslySetInnerHTML={codeHtml}
            />
          </div>
        )
      })}
    </div>
  )
}
