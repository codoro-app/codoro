import { useRovingFocus } from './useRovingFocus'
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
 * Shared syntax-highlighted snippet renderer. PuzzleCardShell uses it
 * read-only for mcq puzzles; TapLine and SwipeBinary reuse it as their own
 * interactive/draggable surface.
 *
 * ## Wrap, never scroll (2026-08-21) -- read this before "optimising" it back
 *
 * A long line used to be handled by `useAutoShrinkFontScale`: measure the
 * widest line, shrink the whole snippet's font until it fit (floor 0.7), and
 * if even the floor didn't fit, keep native `overflow-x: auto` plus a
 * `code-snippet--scrollable` right-edge fade. Both halves of that turned out
 * to be actively harmful on a phone, and BOTH of the mobile-PWA symptoms
 * reported on 2026-08-21 trace back to it:
 *
 * 1. **Inconsistent type size.** Every snippet computed its own scale from
 *    its own longest line, so the multiplier landed anywhere in [0.7, 1.0]
 *    and two consecutive cards rendered code at two visibly different sizes.
 *    That was by construction, not a bug -- which is exactly why it needed
 *    deleting rather than tuning. Measured against the real corpus at the
 *    time: median longest line 38 chars, p90 60; ~33 chars fit at full size
 *    on a 393px-wide phone, so MOST cards were being shrunk by some amount.
 *
 * 2. **Dead swipe.** Once a snippet went `--scrollable`, SwipeBinary's
 *    `scrollableSnippetAncestor` diverted every horizontal touch that
 *    started on the snippet into `snippetEl.scrollLeft` instead of the card
 *    drag. The snippet covers nearly the whole card, so there was almost
 *    nowhere left to start a swipe -- and dragging RIGHT was worse than
 *    "scrolls instead of swipes": `scrollLeft` clamps at 0, so the gesture
 *    did literally nothing. Reproduced with synthetic touches against
 *    production: a 160px drag on a `--scrollable` snippet moved the card 0px
 *    on every frame and never committed. ~28% of the corpus was in that
 *    state. See docs/od-6-swipe-capture-2026-08-21.md for the OD-6 history
 *    this sits on top of.
 *
 * So: one fixed size for every code surface (`--font-size-code`, index.css),
 * and long lines SOFT-WRAP instead of scrolling. `overflow-wrap: anywhere`
 * is deliberate -- code has long unbroken identifiers that `break-word`
 * alone won't split. The flex row gives continuation rows a hanging indent
 * for free: the line-number column is a sibling, so wrapped text aligns
 * under the code column rather than under the number. `items-start` (not
 * `items-center`) keeps the number pinned to the FIRST visual row of a
 * wrapped line instead of floating to its vertical middle.
 *
 * The invariant this buys, which SwipeBinary and DragOrder both depend on:
 * **no code surface in this app ever scrolls horizontally**, so no gesture
 * handler ever has to arbitrate against one. Do not reintroduce
 * `overflow-x: auto` here without also restoring the ~120 lines of
 * scroll-forwarding this deletion allowed. Scrubber.tsx and DragOrder.tsx
 * follow the same rule, so code text is sized and wrapped identically on
 * every surface that renders it.
 */
export function CodeSnippet({ lines, onLineClick, lineState }: CodeSnippetProps) {
  const interactive = onLineClick !== undefined
  const { itemProps } = useRovingFocus(lines.length, !interactive)

  // 2b.0: `code-snippet`/`code-snippet__line` stay literal (test-asserted --
  // CodeSnippet.test.tsx/PuzzleCardShell.test.tsx/TapLine.test.tsx all
  // select on them) -- everything else here is Tailwind utilities.
  const className =
    'code-snippet bg-surface-code border border-border rounded-md py-2.5 font-mono text-code leading-[1.5]'

  return (
    <div className={className}>
      {lines.map((line, index) => {
        const state = lineState?.(index) ?? 'default'
        // `code-snippet__line--<state>` markers stay literal alongside the
        // utilities -- TapLine.test.tsx asserts on
        // `className.toContain('wrong'|'reveal-correct')`.
        const stateBg =
          state === 'wrong' ? 'bg-danger-dim' : state === 'reveal-correct' ? 'bg-ok-dim' : ''
        const lineClassName = [
          'code-snippet__line flex items-start gap-3 w-full py-px px-4 text-left border-0 bg-transparent text-text-0 [font:inherit]',
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
        // `min-w-0` is load-bearing: a flex item's automatic min-width is its
        // content's natural UNWRAPPED size, so without it the span refuses to
        // shrink below the longest line and pushes the row wide instead of
        // wrapping inside it -- i.e. it silently restores the overflow this
        // whole change exists to remove.
        const codeClassName =
          'code-snippet__line-code min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]'

        if (interactive) {
          const roving = itemProps(index)
          return (
            <button
              key={index}
              type="button"
              className={lineClassName}
              onClick={() => {
                onLineClick(index)
              }}
              aria-label={`Line ${String(index + 1)}: ${line.text.trim().length > 0 ? line.text : '(blank)'}`}
              tabIndex={roving.tabIndex}
              ref={roving.ref}
              onFocus={roving.onFocus}
              onKeyDown={roving.onKeyDown}
            >
              {lineNumber}
              <span className={codeClassName} dangerouslySetInnerHTML={codeHtml} />
            </button>
          )
        }

        return (
          <div key={index} className={lineClassName}>
            {lineNumber}
            <span className={codeClassName} dangerouslySetInnerHTML={codeHtml} />
          </div>
        )
      })}
    </div>
  )
}
