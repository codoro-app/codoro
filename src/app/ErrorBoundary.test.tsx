import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

const trackErrorMock = vi.fn()

vi.mock('../telemetry', () => ({
  trackError: (...args: unknown[]) => {
    trackErrorMock(...args)
  },
}))

function Bomb(): never {
  throw new Error('kaboom')
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    trackErrorMock.mockReset()
    // React logs caught render errors to the console by default; keep test
    // output clean since we assert on the error via trackError instead.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('All good')).toBeInTheDocument()
    expect(trackErrorMock).not.toHaveBeenCalled()
  })

  it('renders a friendly fallback instead of the crashed tree when a child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.queryByText('All good')).not.toBeInTheDocument()
    // Friendly fallback, not a blank page and not a raw stack trace.
    expect(screen.getByRole('heading')).toBeInTheDocument()
    expect(screen.queryByText(/kaboom/)).not.toBeInTheDocument()
  })

  it('calls trackError exactly once with a reasonable payload when a child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(trackErrorMock).toHaveBeenCalledTimes(1)
    const [error, context] = trackErrorMock.mock.calls[0] as [unknown, unknown]
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('kaboom')
    expect(typeof context).toBe('string')
  })
})
