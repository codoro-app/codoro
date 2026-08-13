import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Scrubber } from './Scrubber'
import type { ScrubberPuzzle } from '../../content'

const snippet = 'let total = 0\nfor (let i = 0; i < 3; i++) {\n  total += i\n}\nconsole.log(total)'

const steps: ScrubberPuzzle['steps'] = [
  { line: 0, vars: { total: '0' } },
  { line: 1, vars: { total: '0', i: '0' } },
  { line: 2, vars: { total: '0', i: '0' } },
  { line: 1, vars: { total: '0', i: '1' } },
  { line: 4, vars: { total: '3', i: '3' }, output: '9' },
]

/** Reads `.scrubber__vars-row` as [name, value] pairs, in DOM order. */
function readVarRows(container: HTMLElement): [string, string][] {
  return Array.from(container.querySelectorAll('.scrubber__vars-row')).map((row) => [
    row.querySelector('.scrubber__vars-name')?.textContent ?? '',
    row.querySelector('.scrubber__vars-value')?.textContent ?? '',
  ])
}

describe('Scrubber', () => {
  it('highlights the current step’s line and no other', () => {
    const { container } = render(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={2}
        onScrub={vi.fn()}
        maxAllowedIndex={4}
      />,
    )

    const highlighted = container.querySelectorAll('.scrubber__code-line--current')
    expect(highlighted).toHaveLength(1)
    // steps[2].line === 2 -> zero-indexed line 2 is "  total += i" (third line, 1-based number 3).
    expect(highlighted[0]?.textContent).toContain('total += i')
  })

  it('renders the variable panel for the current step in JSON key order, without sorting', () => {
    const { container } = render(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={3}
        onScrub={vi.fn()}
        maxAllowedIndex={4}
      />,
    )

    // steps[3].vars is { total: '0', i: '1' } — total first, i second, exactly
    // the JSON's own key order (i is NOT alphabetically first).
    expect(readVarRows(container)).toEqual([
      ['total', '0'],
      ['i', '1'],
    ])
  })

  it('keeps the same variable row order across different steps (stable key order)', () => {
    const { container, rerender } = render(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={1}
        onScrub={vi.fn()}
        maxAllowedIndex={4}
      />,
    )
    expect(readVarRows(container).map(([name]) => name)).toEqual(['total', 'i'])

    rerender(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={4}
        onScrub={vi.fn()}
        maxAllowedIndex={4}
      />,
    )
    expect(readVarRows(container).map(([name]) => name)).toEqual(['total', 'i'])
  })

  it('reserves stable height on the variable panel so the Prev/Next arrows never move as the var count grows across steps', () => {
    const { container, rerender } = render(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={0}
        onScrub={vi.fn()}
        maxAllowedIndex={4}
      />,
    )
    // steps[0].vars has 1 row; steps[1].vars has 2 — a real growth across
    // this puzzle's own steps (the repro: speed-tapping Next while a step
    // introduces a new variable pushes the arrow row below it down).
    // Reads the element's own inline style (not getComputedStyle, which
    // jsdom resolves to CSS-spec defaults like 'auto' regardless of what's
    // actually rendered — useless for proving a real fix here).
    const panelAtOneRow = container.querySelector('[aria-label="Variables"]')
    if (!(panelAtOneRow instanceof HTMLElement)) {
      throw new Error('Variables panel not found')
    }
    const minHeightAtOneRow = panelAtOneRow.style.minHeight
    // Must reserve real height for the puzzle's max row count (2, from
    // steps[1]/[2]/[3]/[4]) even while only 1 row is actually rendered — an
    // empty inline style means "reserves nothing", the exact bug this fix
    // closes (the panel grows a row and pushes the arrows below it down).
    expect(minHeightAtOneRow).not.toBe('')

    rerender(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={1}
        onScrub={vi.fn()}
        maxAllowedIndex={4}
      />,
    )
    const panelAtTwoRows = container.querySelector('[aria-label="Variables"]')
    if (!(panelAtTwoRows instanceof HTMLElement)) {
      throw new Error('Variables panel not found')
    }
    expect(panelAtTwoRows.style.minHeight).toBe(minHeightAtOneRow)
  })

  it('renders output since the previous step only when the current step produced one', () => {
    const { container, rerender } = render(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={1}
        onScrub={vi.fn()}
        maxAllowedIndex={4}
      />,
    )
    expect(screen.queryByText(/Output since previous step/)).not.toBeInTheDocument()

    rerender(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={4}
        onScrub={vi.fn()}
        maxAllowedIndex={4}
      />,
    )
    expect(screen.getByText(/Output since previous step/)).toBeInTheDocument()
    expect(container.querySelector('.scrubber__output-value')?.textContent).toBe('9')
  })

  it('masks every variable named in maskedVarNames instead of its real value', () => {
    const { container } = render(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={3}
        onScrub={vi.fn()}
        maxAllowedIndex={4}
        maskedVarNames={['i']}
      />,
    )

    // "total" (not masked) still shows its real value; "i" (masked) shows
    // the mask marker instead of its real value "1".
    expect(readVarRows(container)).toEqual([
      ['total', '0'],
      ['i', '?'],
    ])
  })

  it('masks every row named in a multi-name maskedVarNames set, not just one', () => {
    const { container } = render(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={3}
        onScrub={vi.fn()}
        maxAllowedIndex={4}
        maskedVarNames={['total', 'i']}
      />,
    )

    // Both rows named in the set render masked, not just the first —
    // proves maskedVarNames really is a set, not a single-value prop in a
    // trench coat.
    expect(readVarRows(container)).toEqual([
      ['total', '?'],
      ['i', '?'],
    ])
  })

  it('masks output instead of its real text when maskOutput is set', () => {
    const { container } = render(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={4}
        onScrub={vi.fn()}
        maxAllowedIndex={4}
        maskOutput
      />,
    )

    expect(screen.getByText(/Output since previous step/)).toBeInTheDocument()
    expect(container.querySelector('.scrubber__output-value')?.textContent).toBe('?')
  })

  it('ArrowRight does not request a step past maxAllowedIndex', () => {
    const onScrub = vi.fn()
    render(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={2}
        onScrub={onScrub}
        maxAllowedIndex={2}
      />,
    )

    const track = screen.getByRole('slider')
    fireEvent.keyDown(track, { key: 'ArrowRight' })
    expect(onScrub).not.toHaveBeenCalled()
  })

  it('ArrowLeft/ArrowRight step by exactly one within range', () => {
    const onScrub = vi.fn()
    render(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={2}
        onScrub={onScrub}
        maxAllowedIndex={4}
      />,
    )

    const track = screen.getByRole('slider')
    fireEvent.keyDown(track, { key: 'ArrowRight' })
    expect(onScrub).toHaveBeenCalledWith(3)

    fireEvent.keyDown(track, { key: 'ArrowLeft' })
    expect(onScrub).toHaveBeenCalledWith(1)
  })

  it('ArrowLeft at step 0 does not request a negative index', () => {
    const onScrub = vi.fn()
    render(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={0}
        onScrub={onScrub}
        maxAllowedIndex={4}
      />,
    )

    const track = screen.getByRole('slider')
    fireEvent.keyDown(track, { key: 'ArrowLeft' })
    expect(onScrub).not.toHaveBeenCalled()
  })

  it('prev/next tap targets are disabled at the respective bound and call onScrub otherwise', () => {
    const onScrub = vi.fn()
    const { rerender } = render(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={0}
        onScrub={onScrub}
        maxAllowedIndex={2}
      />,
    )

    expect(screen.getByRole('button', { name: 'Previous step' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next step' })).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
    expect(onScrub).toHaveBeenCalledWith(1)

    rerender(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={2}
        onScrub={onScrub}
        maxAllowedIndex={2}
      />,
    )
    expect(screen.getByRole('button', { name: 'Next step' })).toBeDisabled()
  })

  it('throws for an out-of-range stepIndex instead of silently rendering nothing', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() =>
      render(
        <Scrubber
          snippet={snippet}
          language="javascript"
          steps={steps}
          stepIndex={99}
          onScrub={vi.fn()}
          maxAllowedIndex={4}
        />,
      ),
    ).toThrow(/stepIndex 99 out of range/)
    consoleError.mockRestore()
  })
})
