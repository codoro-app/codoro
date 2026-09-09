import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { GhostBar } from './GhostBar'
import type { ChallengeAttemptInput } from '../../challenge'

const theirResult: ChallengeAttemptInput = { puzzleId: 'p1', correct: true, time_ms: 3000 }

afterEach(() => {
  vi.useRealTimers()
})

/** The rendered ghost bar's own text, or null if it didn't render at all — not queried by role, since `role="status"` is already PuzzleCardShell's own meaning elsewhere on this page. */
function ghostBarText(container: HTMLElement): string | null {
  return container.querySelector('.ghost-bar')?.textContent ?? null
}

describe('GhostBar', () => {
  it('renders nothing when there is no payload result for this puzzle index', () => {
    const { container } = render(
      <GhostBar
        challengerName="Alex"
        theirResult={undefined}
        yourResult={undefined}
        servedAt={Date.now()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing before the clock has started (servedAt null)', () => {
    const { container } = render(
      <GhostBar
        challengerName="Alex"
        theirResult={theirResult}
        yourResult={undefined}
        servedAt={null}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the challenger name and time while running', () => {
    vi.useFakeTimers()
    const { container } = render(
      <GhostBar
        challengerName="Alex"
        theirResult={theirResult}
        yourResult={undefined}
        servedAt={Date.now()}
      />,
    )
    expect(ghostBarText(container)).toBe('Alex · 3.0s')
  })

  it('falls back to "Friend" when the challenger has no name', () => {
    vi.useFakeTimers()
    const { container } = render(
      <GhostBar
        challengerName={null}
        theirResult={theirResult}
        yourResult={undefined}
        servedAt={Date.now()}
      />,
    )
    expect(ghostBarText(container)).toBe('Friend · 3.0s')
  })

  it('shows "finished" once the challenger\'s time elapses unanswered', () => {
    vi.useFakeTimers()
    const servedAt = Date.now()
    const { container } = render(
      <GhostBar
        challengerName="Alex"
        theirResult={theirResult}
        yourResult={undefined}
        servedAt={servedAt}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(ghostBarText(container)).toBe('Alex finished')
  })

  it('shows "missed this one" when the challenger\'s own answer was wrong', () => {
    vi.useFakeTimers()
    const servedAt = Date.now()
    const { container } = render(
      <GhostBar
        challengerName="Alex"
        theirResult={{ ...theirResult, correct: false }}
        yourResult={undefined}
        servedAt={servedAt}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(ghostBarText(container)).toBe('Alex missed this one')
  })

  it("shows the margin ahead once the recipient answers before the challenger's time elapses", () => {
    vi.useFakeTimers()
    const servedAt = Date.now()
    vi.advanceTimersByTime(1000)
    const { container } = render(
      <GhostBar
        challengerName="Alex"
        theirResult={theirResult}
        yourResult={{ correct: true, time_ms: 1000 }}
        servedAt={servedAt}
      />,
    )
    expect(ghostBarText(container)).toBe('+2.0s ahead')
  })
})
