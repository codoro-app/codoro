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

// Dynamic import after the mock above is registered, matching the pattern
// used elsewhere in this repo when a module under test imports the
// telemetry barrel.
async function loadFeedbackLink() {
  return import('./FeedbackLink')
}

describe('FeedbackLink', () => {
  it('renders an external link (not an embed) pointing at the Tally URL constant', async () => {
    const { FeedbackLink, FEEDBACK_URL } = await loadFeedbackLink()
    render(<FeedbackLink surface="footer" />)
    const link = screen.getByRole('link', { name: 'Feedback' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', FEEDBACK_URL)
  })

  it('opens in a new tab with rel="noopener noreferrer" (no window.opener access, no embed)', async () => {
    const { FeedbackLink } = await loadFeedbackLink()
    render(<FeedbackLink surface="footer" />)
    const link = screen.getByRole('link', { name: 'Feedback' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('applies the className passed by the caller', async () => {
    const { FeedbackLink } = await loadFeedbackLink()
    render(<FeedbackLink surface="footer" className="test-class" />)
    expect(screen.getByRole('link', { name: 'Feedback' })).toHaveClass('test-class')
  })

  it('fires feedback_link_clicked with surface: "footer" when rendered in the footer', async () => {
    const user = userEvent.setup()
    const { FeedbackLink } = await loadFeedbackLink()
    render(<FeedbackLink surface="footer" />)
    await user.click(screen.getByRole('link', { name: 'Feedback' }))
    expect(trackFeedbackLinkClicked).toHaveBeenCalledWith({ surface: 'footer' })
  })

  it('fires feedback_link_clicked with surface: "settings" when rendered in Settings', async () => {
    const user = userEvent.setup()
    const { FeedbackLink } = await loadFeedbackLink()
    render(<FeedbackLink surface="settings" />)
    await user.click(screen.getByRole('link', { name: 'Feedback' }))
    expect(trackFeedbackLinkClicked).toHaveBeenCalledWith({ surface: 'settings' })
  })

  it('calls the optional onClick prop (in addition to tracking) when provided', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { FeedbackLink } = await loadFeedbackLink()
    render(<FeedbackLink surface="daily_nudge" onClick={onClick} />)
    await user.click(screen.getByRole('link', { name: 'Feedback' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(trackFeedbackLinkClicked).toHaveBeenCalledWith({ surface: 'daily_nudge' })
  })
})
