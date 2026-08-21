import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { CodeSnippet } from './CodeSnippet'
import { highlightSnippet } from './highlightSnippet'

const lines = highlightSnippet(
  'private Map<String, String> cache = new HashMap<>();\nString value = computeExpensiveValue(key);',
  'java',
)

/** This repo's noUncheckedIndexedAccess/no-non-null-assertion convention (see src/test/nth.ts) applied to querySelector. */
function getSnippetElement(container: HTMLElement): HTMLElement {
  const snippet = container.querySelector<HTMLElement>('.code-snippet')
  if (!snippet) {
    throw new Error('Expected a rendered .code-snippet element')
  }
  return snippet
}

describe('CodeSnippet', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /*
   * These replace three tests that asserted the old measure-and-shrink
   * behavior (a per-snippet `--code-snippet-font-scale` in [0.7, 1] plus a
   * `code-snippet--scrollable` fallback). That behavior was deleted on
   * 2026-08-21 — see CodeSnippet.tsx's doc comment — so what's worth
   * guarding now is the INVARIANT the deletion bought, not a replacement
   * measurement: no code surface scrolls horizontally, and every snippet
   * renders at the same size regardless of content.
   *
   * These are deliberately assertions on the rendered class contract rather
   * than on computed layout: jsdom does no layout, so a "does it actually
   * wrap" test here could only ever re-assert the stylesheet back at
   * itself. The wrap behavior itself was verified in a real engine (see the
   * capture referenced from CodeSnippet.tsx).
   */
  it('renders at the shared code size with no per-snippet scale, whatever the content', () => {
    const short = highlightSnippet('int x = 1;', 'java')
    const long = highlightSnippet(
      'public static Map<String, List<Integer>> groupByRemainder(int[] values, int modulus) {',
      'java',
    )

    const a = getSnippetElement(render(<CodeSnippet lines={short} />).container)
    const b = getSnippetElement(render(<CodeSnippet lines={long} />).container)

    // Same type size for both, and no inline scale var driving it.
    expect(a.className).toContain('text-code')
    expect(b.className).toContain('text-code')
    expect(a.style.getPropertyValue('--code-snippet-font-scale')).toBe('')
    expect(b.style.getPropertyValue('--code-snippet-font-scale')).toBe('')
    expect(a.className).toBe(b.className)
  })

  it('never becomes a horizontal scroll container (SwipeBinary depends on this)', () => {
    // The regression this guards is not cosmetic: a horizontally scrollable
    // snippet is a gesture container competing with SwipeBinary's card drag,
    // and reintroducing one is what made ~28% of swipe puzzles unswipeable.
    const veryLong = highlightSnippet(
      'System.out.println(String.format("%s -> %s", key, cache.getOrDefault(key, "missing")));',
      'java',
    )
    const snippet = getSnippetElement(render(<CodeSnippet lines={veryLong} />).container)

    expect(snippet.className).not.toContain('overflow-x-auto')
    expect(snippet.className).not.toContain('code-snippet--scrollable')
  })

  it('wraps long lines instead of clipping them to one row', () => {
    const snippet = getSnippetElement(render(<CodeSnippet lines={lines} />).container)
    const codeSpans = snippet.querySelectorAll<HTMLElement>('.code-snippet__line-code')

    expect(codeSpans.length).toBeGreaterThan(0)
    codeSpans.forEach((span) => {
      // `pre-wrap` (not `pre`) is what lets a long line wrap while still
      // preserving the snippet's leading indentation.
      expect(span.className).toContain('whitespace-pre-wrap')
      expect(span.className).not.toContain('whitespace-pre ')
      // Without min-w-0 the flex item refuses to shrink below its content's
      // natural unwrapped width, which silently restores the overflow.
      expect(span.className).toContain('min-w-0')
    })

    // The line number stays aligned to the FIRST visual row of a wrapped
    // line, not floated to the row's vertical middle.
    const line = snippet.querySelector<HTMLElement>('.code-snippet__line')
    expect(line?.className).toContain('items-start')
  })

  it('renders without needing ResizeObserver (it no longer measures anything)', () => {
    // Kept from the measure-and-shrink era as a cheap guard that nothing
    // reintroduces a layout-measuring effect here: jsdom has no
    // ResizeObserver, so anything that starts observing would throw.
    expect(typeof ResizeObserver).toBe('undefined')
    expect(() => {
      render(<CodeSnippet lines={lines} />)
    }).not.toThrow()
  })
})
