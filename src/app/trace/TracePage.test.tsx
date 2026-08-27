import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TracePage } from './TracePage'
import { loadProfile, createDefaultProfile } from '../../storage'
import type { TraceRunnerProps } from './TraceRunner'

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return { ...actual, loadProfile: vi.fn() }
})

// v4 Phase 4.1: TraceRunner itself (puzzle loading, checkpoints, etc.) is
// covered by its own test suite — this page's only job is choosing what
// `timed` value to pass it, so that's the only thing stubbed here.
vi.mock('./TraceRunner', () => ({
  TraceRunner: ({ timed }: TraceRunnerProps) => <div data-testid="timed-prop">{String(timed)}</div>,
}))

describe('TracePage', () => {
  it('passes timed={false} (the DEFAULT_PREFERENCES value) while the profile is still loading', () => {
    vi.mocked(loadProfile).mockReturnValue(new Promise(() => undefined)) // never resolves
    render(<TracePage />)
    expect(screen.getByTestId('timed-prop')).toHaveTextContent('false')
  })

  it("passes timed={false} once a loaded profile with timerOnTrace: false resolves (today's default, unchanged)", async () => {
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    render(<TracePage />)
    expect(await screen.findByTestId('timed-prop')).toHaveTextContent('false')
  })

  it('passes timed={true} once a loaded profile with the Timer on Trace preference on resolves', async () => {
    const profile = createDefaultProfile()
    vi.mocked(loadProfile).mockResolvedValue({
      ...profile,
      preferences: { ...profile.preferences, timerOnTrace: true },
    })
    render(<TracePage />)
    expect(await screen.findByTestId('timed-prop')).toHaveTextContent('true')
  })

  it('stays at timed={false} if the profile load rejects (cosmetic no-op, not a crash)', async () => {
    vi.mocked(loadProfile).mockRejectedValue(new Error('boom'))
    render(<TracePage />)
    // Nothing to await on success here — assert the stable end state once
    // the rejected promise has had a chance to settle.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByTestId('timed-prop')).toHaveTextContent('false')
  })
})
