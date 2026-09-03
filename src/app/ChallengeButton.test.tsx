import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChallengeButton } from './ChallengeButton'
import { decodeChallengePayload } from '../challenge'
import type { ChallengeAttemptInput } from '../challenge'

const trackChallengeCreate = vi.fn()
vi.mock('../telemetry', () => ({
  trackChallengeCreate: (...args: unknown[]) => {
    trackChallengeCreate(...args)
  },
}))

const attempts: ChallengeAttemptInput[] = [{ puzzleId: 'p1', correct: true, time_ms: 1200 }]

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('ChallengeButton', () => {
  it('renders nothing when attempts is empty', () => {
    const { container } = render(
      <ChallengeButton
        attempts={[]}
        surface="practice"
        introLabel="beat this one"
        challengerName={null}
        onNameNeeded={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders unconditionally once attempts exist — not gated on a streak or any other condition', () => {
    render(
      <ChallengeButton
        attempts={attempts}
        surface="practice"
        introLabel="beat this one"
        challengerName={null}
        onNameNeeded={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /challenge a friend/i })).toBeInTheDocument()
  })

  it('opens the name-prompt sheet on first use (challengerName null)', async () => {
    const user = userEvent.setup()
    render(
      <ChallengeButton
        attempts={attempts}
        surface="practice"
        introLabel="beat this one"
        challengerName={null}
        onNameNeeded={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /challenge a friend/i }))
    expect(screen.getByRole('dialog', { name: 'Your name' })).toBeInTheDocument()
  })

  it('reuses a saved name on subsequent renders — skips the sheet entirely', async () => {
    const user = userEvent.setup()
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    render(
      <ChallengeButton
        attempts={attempts}
        surface="practice"
        introLabel="beat this one"
        challengerName="Joe"
        onNameNeeded={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /challenge a friend/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalled()
    })
    const url = writeTextSpy.mock.calls[0]?.[0]
    if (typeof url !== 'string') throw new Error('expected writeText to have been called')
    const decoded = decodeChallengePayload(url.split('#')[1] ?? '')
    expect(decoded?.challengerName).toBe('Joe')
  })

  it('continuing past the name sheet persists the name via onNameNeeded, then sends using it', async () => {
    const user = userEvent.setup()
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    const onNameNeeded = vi.fn().mockResolvedValue(undefined)
    render(
      <ChallengeButton
        attempts={attempts}
        surface="daily"
        introLabel="beat today's Daily"
        challengerName={null}
        onNameNeeded={onNameNeeded}
      />,
    )

    await user.click(screen.getByRole('button', { name: /challenge a friend/i }))
    // getByLabelText would also match the dialog's own aria-label="Your
    // name" — role: 'textbox' narrows to the actual input.
    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Joe')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(onNameNeeded).toHaveBeenCalledWith('Joe')
    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalled()
    })
    const url = writeTextSpy.mock.calls[0]?.[0]
    if (typeof url !== 'string') throw new Error('expected writeText to have been called')
    const decoded = decodeChallengePayload(url.split('#')[1] ?? '')
    expect(decoded?.challengerName).toBe('Joe')
  })

  it('skipping the name sheet never blocks sharing — sends immediately with a null challengerName', async () => {
    const user = userEvent.setup()
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    const onNameNeeded = vi.fn()
    render(
      <ChallengeButton
        attempts={attempts}
        surface="rush"
        introLabel="beat my run of 5"
        challengerName={null}
        onNameNeeded={onNameNeeded}
      />,
    )

    await user.click(screen.getByRole('button', { name: /challenge a friend/i }))
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(onNameNeeded).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalled()
    })
    const url = writeTextSpy.mock.calls[0]?.[0]
    if (typeof url !== 'string') throw new Error('expected writeText to have been called')
    const decoded = decodeChallengePayload(url.split('#')[1] ?? '')
    expect(decoded?.challengerName).toBeNull()
  })

  it('fires trackChallengeCreate with the given surface and the encoded puzzle count', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText')
    render(
      <ChallengeButton
        attempts={attempts}
        surface="boss"
        introLabel="beat my Boss run"
        challengerName="Joe"
        onNameNeeded={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /challenge a friend/i }))

    await waitFor(() => {
      expect(trackChallengeCreate).toHaveBeenCalledWith({ surface: 'boss', puzzle_count: 1 })
    })
  })

  it('builds the outbound message from introLabel and shows a copied confirmation', async () => {
    const user = userEvent.setup()
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    render(
      <ChallengeButton
        attempts={attempts}
        surface="practice"
        introLabel="beat my streak of 4"
        challengerName="Joe"
        onNameNeeded={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /challenge a friend/i }))

    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalledWith(
        expect.stringContaining('Can you beat my streak of 4?'),
      )
    })
    expect(await screen.findByRole('button', { name: 'Link copied!' })).toBeInTheDocument()
  })

  describe('the dedicated "Copy challenge link" control (desktop feedback: navigator.share can be Windows Nearby Share, which has no way to paste into an email)', () => {
    it('renders alongside the main button', () => {
      render(
        <ChallengeButton
          attempts={attempts}
          surface="practice"
          introLabel="beat this one"
          challengerName="Joe"
          onNameNeeded={vi.fn()}
        />,
      )
      expect(screen.getByRole('button', { name: 'Copy challenge link' })).toBeInTheDocument()
    })

    it('always force-copies, never calling navigator.share, even when it is available', async () => {
      const user = userEvent.setup()
      const shareSpy = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'share', { value: shareSpy, configurable: true })
      const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
      try {
        render(
          <ChallengeButton
            attempts={attempts}
            surface="practice"
            introLabel="beat this one"
            challengerName="Joe"
            onNameNeeded={vi.fn()}
          />,
        )

        await user.click(screen.getByRole('button', { name: 'Copy challenge link' }))

        expect(shareSpy).not.toHaveBeenCalled()
        await waitFor(() => {
          expect(writeTextSpy).toHaveBeenCalled()
        })
        expect(await screen.findByRole('button', { name: 'Link copied!' })).toBeInTheDocument()
      } finally {
        Reflect.deleteProperty(navigator, 'share')
      }
    })

    it('goes through the same first-use name prompt as the main button, dispatching the copy once a name is available', async () => {
      const user = userEvent.setup()
      const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
      const onNameNeeded = vi.fn().mockResolvedValue(undefined)
      render(
        <ChallengeButton
          attempts={attempts}
          surface="practice"
          introLabel="beat this one"
          challengerName={null}
          onNameNeeded={onNameNeeded}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Copy challenge link' }))
      expect(screen.getByRole('dialog', { name: 'Your name' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Skip' }))

      await waitFor(() => {
        expect(writeTextSpy).toHaveBeenCalled()
      })
      expect(onNameNeeded).not.toHaveBeenCalled()
      const url = writeTextSpy.mock.calls[0]?.[0]
      if (typeof url !== 'string') throw new Error('expected writeText to have been called')
      const decoded = decodeChallengePayload(url.split('#')[1] ?? '')
      expect(decoded?.challengerName).toBeNull()
    })

    it('fires trackChallengeCreate the same as the main button', async () => {
      const user = userEvent.setup()
      vi.spyOn(navigator.clipboard, 'writeText')
      render(
        <ChallengeButton
          attempts={attempts}
          surface="challenge"
          introLabel="beat my counter-challenge"
          challengerName="Joe"
          onNameNeeded={vi.fn()}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Copy challenge link' }))

      await waitFor(() => {
        expect(trackChallengeCreate).toHaveBeenCalledWith({ surface: 'challenge', puzzle_count: 1 })
      })
    })
  })
})
