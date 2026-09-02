import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const trackFeedbackLinkClicked = vi.fn()

vi.mock('../telemetry', () => ({
  trackFeedbackLinkClicked: (...args: unknown[]) => {
    trackFeedbackLinkClicked(...args)
  },
}))

afterEach(() => {
  vi.clearAllMocks()
})

async function loadFeedbackNudge() {
  return import('./FeedbackNudge')
}

describe('FeedbackNudge', () => {
  it('renders a Feedback link pointing at the Tally form', async () => {
    const { FeedbackNudge } = await loadFeedbackNudge()
    render(<FeedbackNudge surface="daily_nudge" onDismiss={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Feedback' })).toHaveAttribute(
      'href',
      'https://tally.so/r/Xxb0v4',
    )
  })

  it('calls onDismiss when the dismiss button is clicked', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    const { FeedbackNudge } = await loadFeedbackNudge()
    render(<FeedbackNudge surface="daily_nudge" onDismiss={onDismiss} />)
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss when the Feedback link itself is clicked (click-through also suppresses it)', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    const { FeedbackNudge } = await loadFeedbackNudge()
    render(<FeedbackNudge surface="home_nudge" onDismiss={onDismiss} />)
    await user.click(screen.getByRole('link', { name: 'Feedback' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(trackFeedbackLinkClicked).toHaveBeenCalledWith({ surface: 'home_nudge' })
  })
})
