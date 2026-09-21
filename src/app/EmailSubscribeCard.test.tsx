import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Router } from 'wouter'
import { EmailSubscribeCard } from './EmailSubscribeCard'
import { ApiError, apiFetch } from '../auth/api'
import { trackEmailSignup } from '../telemetry'

vi.mock('../auth/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
vi.mock('../telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../telemetry')>()
  return { ...actual, trackEmailSignup: vi.fn() }
})

const apiFetchMock = vi.mocked(apiFetch)
const trackEmailSignupMock = vi.mocked(trackEmailSignup)

afterEach(() => {
  localStorage.clear()
  apiFetchMock.mockReset()
  trackEmailSignupMock.mockReset()
})

function renderCard() {
  return render(
    <Router>
      <EmailSubscribeCard surface="challenge_comparison" />
    </Router>,
  )
}

describe('EmailSubscribeCard', () => {
  it('renders nothing once the nudge has been dismissed', () => {
    localStorage.setItem('codoro:email-subscribe-dismissed', '1')
    const { container } = renderCard()
    expect(container).toBeEmptyDOMElement()
  })

  it('submits the typed email, fires telemetry, and shows the thank-you line on success', async () => {
    apiFetchMock.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    renderCard()

    await user.type(screen.getByLabelText('Email address'), 'player@example.com')
    await user.click(screen.getByRole('button', { name: 'Notify me' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent("You're on the list")
    })
    expect(apiFetchMock).toHaveBeenCalledWith('/api/subscribe', {
      method: 'POST',
      body: { email: 'player@example.com', hp: '' },
    })
    expect(trackEmailSignupMock).toHaveBeenCalledWith({ surface: 'challenge_comparison' })
    expect(localStorage.getItem('codoro:email-subscribe-dismissed')).toBe('1')
  }, 15000)

  it('shows an honest error and stays visible when the request fails', async () => {
    apiFetchMock.mockRejectedValue(new ApiError('server', 'Could not subscribe — try again.'))
    const user = userEvent.setup()
    renderCard()

    await user.type(screen.getByLabelText('Email address'), 'player@example.com')
    await user.click(screen.getByRole('button', { name: 'Notify me' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not subscribe')
    })
    expect(trackEmailSignupMock).not.toHaveBeenCalled()
    expect(localStorage.getItem('codoro:email-subscribe-dismissed')).toBeNull()
  })

  it('"No thanks" dismisses without ever calling the API', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: 'No thanks' }))

    expect(apiFetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem('codoro:email-subscribe-dismissed')).toBe('1')
  })
})
