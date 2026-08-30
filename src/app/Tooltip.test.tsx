import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tooltip } from './Tooltip'

describe('Tooltip', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // Belt-and-braces: a test that fails before reaching its own
    // `vi.useRealTimers()` would otherwise leak fake timers into whatever
    // test runs next (and userEvent hangs indefinitely under leaked fake
    // timers it wasn't configured to advance).
    vi.useRealTimers()
  })

  it('renders the trigger untouched, with the tooltip hidden by default', () => {
    render(
      <Tooltip label="Previous step">
        <button type="button">‹</button>
      </Tooltip>,
    )
    const trigger = screen.getByRole('button', { name: '‹' })
    expect(trigger).toBeInTheDocument()
    const bubble = screen.getByRole('tooltip', { hidden: true })
    expect(bubble).toHaveTextContent('Previous step')
    expect(bubble.className).toMatch(/opacity-0/)
  })

  it('wires aria-describedby from the trigger to the tooltip bubble, merging with an existing value', () => {
    render(
      <Tooltip label="Copy puzzle link">
        <button type="button" aria-describedby="existing-desc">
          Copy
        </button>
      </Tooltip>,
    )
    const trigger = screen.getByRole('button', { name: 'Copy' })
    const bubble = screen.getByRole('tooltip', { hidden: true })
    const describedBy = trigger.getAttribute('aria-describedby')
    expect(describedBy).toContain('existing-desc')
    expect(describedBy).toContain(bubble.id)
  })

  it('shows immediately on keyboard focus, no delay', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip label="Next step">
        <button type="button">›</button>
      </Tooltip>,
    )
    await user.tab()
    expect(screen.getByRole('button', { name: '›' })).toHaveFocus()
    expect(screen.getByRole('tooltip').className).toMatch(/opacity-100/)
  })

  it('hides on blur', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Tooltip label="Next step">
          <button type="button">›</button>
        </Tooltip>
        <button type="button">elsewhere</button>
      </>,
    )
    await user.tab()
    expect(screen.getByRole('tooltip').className).toMatch(/opacity-100/)
    await user.tab()
    expect(screen.getByRole('tooltip').className).toMatch(/opacity-0/)
  })

  it('shows on hover after a short delay, not instantly', () => {
    vi.useFakeTimers()
    render(
      <Tooltip label="Share">
        <button type="button">share-icon</button>
      </Tooltip>,
    )
    const trigger = screen.getByRole('button', { name: 'share-icon' })
    fireEvent.mouseEnter(trigger)
    expect(screen.getByRole('tooltip').className).toMatch(/opacity-0/)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(screen.getByRole('tooltip').className).toMatch(/opacity-100/)
  })

  it('shows immediately on a touch tap and auto-dismisses without blocking the click', () => {
    vi.useFakeTimers()
    const onClick = vi.fn()
    render(
      <Tooltip label="Share">
        <button type="button" onClick={onClick}>
          share-icon
        </button>
      </Tooltip>,
    )
    const trigger = screen.getByRole('button', { name: 'share-icon' })
    fireEvent.pointerDown(trigger, { pointerType: 'touch' })
    expect(screen.getByRole('tooltip').className).toMatch(/opacity-100/)

    fireEvent.click(trigger)
    expect(onClick).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(1600)
    })
    expect(screen.getByRole('tooltip').className).toMatch(/opacity-0/)
  })

  it('hides on Escape', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip label="Next step">
        <button type="button">›</button>
      </Tooltip>,
    )
    await user.tab()
    expect(screen.getByRole('tooltip').className).toMatch(/opacity-100/)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('tooltip').className).toMatch(/opacity-0/)
  })
})
