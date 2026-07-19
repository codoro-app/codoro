import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { CodeSnippet } from './CodeSnippet'
import { highlightSnippet } from './highlightSnippet'

const lines = highlightSnippet(
  'private Map<String, String> cache = new HashMap<>();\nString value = computeExpensiveValue(key);',
  'java',
)

/**
 * jsdom never lays out real content, so scrollWidth/clientWidth default to
 * 0 — stub them on Element.prototype for the duration of one test so
 * CodeSnippet's useLayoutEffect measurement has real overflow to react to.
 * Restored via afterEach so other test files' unrelated renders aren't
 * affected.
 */
function stubMeasurements(scrollWidth: number, clientWidth: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth)
}

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

  it('does not shrink or mark scrollable when every line already fits', () => {
    stubMeasurements(300, 400)

    const { container } = render(<CodeSnippet lines={lines} />)
    const snippet = getSnippetElement(container)

    expect(snippet.className).not.toContain('code-snippet--scrollable')
    expect(snippet.style.getPropertyValue('--code-snippet-font-scale')).toBe('1')
  })

  it('shrinks the font to fit when the widest line moderately overflows', () => {
    // clientWidth 300 / scrollWidth 360 -> scale 300/360 = 0.8333..., above
    // the 0.7 floor, so this should fit at a shrunk (not floored) scale and
    // not need the scroll affordance.
    stubMeasurements(360, 300)

    const { container } = render(<CodeSnippet lines={lines} />)
    const snippet = getSnippetElement(container)

    const scale = Number(snippet.style.getPropertyValue('--code-snippet-font-scale'))
    expect(scale).toBeCloseTo(300 / 360, 5)
    expect(snippet.className).not.toContain('code-snippet--scrollable')
  })

  it('floors the shrink and falls back to a scrollable affordance for extreme overflow', () => {
    // clientWidth 100 / scrollWidth 1000 would compute scale 0.1, well
    // under the 0.7 floor — must clamp to the floor and mark scrollable
    // rather than shrinking text to the point of illegibility.
    stubMeasurements(1000, 100)

    const { container } = render(<CodeSnippet lines={lines} />)
    const snippet = getSnippetElement(container)

    expect(snippet.style.getPropertyValue('--code-snippet-font-scale')).toBe('0.7')
    expect(snippet.className).toContain('code-snippet--scrollable')
  })

  it('does not throw in an environment without ResizeObserver (e.g. jsdom)', () => {
    stubMeasurements(300, 400)
    expect(typeof ResizeObserver).toBe('undefined')
    expect(() => {
      render(<CodeSnippet lines={lines} />)
    }).not.toThrow()
  })
})
