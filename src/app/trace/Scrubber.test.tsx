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

  it('masks the checkpoint target’s value instead of its real value when maskedTarget is set', () => {
    const { container } = render(
      <Scrubber
        snippet={snippet}
        language="javascript"
        steps={steps}
        stepIndex={3}
        onScrub={vi.fn()}
        maxAllowedIndex={4}
        maskedTarget="i"
      />,
    )

    // "total" (not masked) still shows its real value; "i" (masked) shows
    // the mask marker instead of its real value "1".
    expect(readVarRows(container)).toEqual([
      ['total', '0'],
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
