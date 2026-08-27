import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { nth } from '../../test/nth'
import { useRovingFocus } from './useRovingFocus'

function List({ count, locked }: { count: number; locked: boolean }) {
  const { itemProps } = useRovingFocus(count, locked)
  return (
    <div>
      {Array.from({ length: count }, (_, index) => (
        <button key={index} type="button" {...itemProps(index)}>
          Item {index}
        </button>
      ))}
    </div>
  )
}

describe('useRovingFocus', () => {
  it('only the first item is tabbable until arrow keys move the roving index', () => {
    render(<List count={3} locked={false} />)
    const buttons = screen.getAllByRole('button')
    expect(nth(buttons, 0)).toHaveAttribute('tabindex', '0')
    expect(nth(buttons, 1)).toHaveAttribute('tabindex', '-1')
    expect(nth(buttons, 2)).toHaveAttribute('tabindex', '-1')
  })

  it('ArrowDown moves the roving index and real focus to the next item, wrapping past the end', () => {
    render(<List count={3} locked={false} />)
    const buttons = screen.getAllByRole('button')
    nth(buttons, 0).focus()

    fireEvent.keyDown(nth(buttons, 0), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(nth(buttons, 1))
    expect(nth(buttons, 1)).toHaveAttribute('tabindex', '0')
    expect(nth(buttons, 0)).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(nth(buttons, 1), { key: 'ArrowDown' })
    fireEvent.keyDown(nth(buttons, 2), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(nth(buttons, 0))
  })

  it('ArrowUp moves focus to the previous item, wrapping to the last item from the first', () => {
    render(<List count={3} locked={false} />)
    const buttons = screen.getAllByRole('button')
    nth(buttons, 0).focus()

    fireEvent.keyDown(nth(buttons, 0), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(nth(buttons, 2))
  })

  it('clicking (focusing) any item syncs the roving index to it', () => {
    render(<List count={3} locked={false} />)
    const buttons = screen.getAllByRole('button')

    fireEvent.focus(nth(buttons, 2))
    expect(nth(buttons, 2)).toHaveAttribute('tabindex', '0')
    expect(nth(buttons, 0)).toHaveAttribute('tabindex', '-1')
  })

  it('locked freezes navigation — arrow keys do nothing', () => {
    render(<List count={3} locked={true} />)
    const buttons = screen.getAllByRole('button')
    nth(buttons, 0).focus()

    fireEvent.keyDown(nth(buttons, 0), { key: 'ArrowDown' })
    expect(document.activeElement).not.toBe(nth(buttons, 1))
  })
})
