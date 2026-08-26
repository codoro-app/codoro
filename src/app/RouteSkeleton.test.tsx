import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RouteSkeleton } from './RouteSkeleton'

/**
 * Final-review finding: the shimmer blocks are `aria-hidden` (correctly —
 * they're decorative geometry), which left the whole component with nothing
 * announceable. That was tolerable while this was only App.tsx's
 * route-chunk Suspense fallback, but the content-metadata-lazy-load pass
 * made it the cold-boot state on Practice/Trace/Rush/Daily as well — four
 * surfaces that previously rendered synchronously — so a screen-reader user
 * would hear nothing at all for the duration of the fetch.
 */
describe('RouteSkeleton — accessibility', () => {
  it('exposes an announceable status region alongside the aria-hidden shimmer', () => {
    render(<RouteSkeleton />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/loading/i)
    // Must not be inside the aria-hidden subtree — an `aria-hidden` ancestor
    // removes descendants from the accessibility tree regardless of their
    // own role, which would silently undo this fix.
    expect(status.closest('[aria-hidden="true"]')).toBeNull()
  })

  it('keeps the shimmer itself hidden from assistive tech', () => {
    render(<RouteSkeleton />)
    expect(screen.getByTestId('route-skeleton')).toHaveAttribute('aria-hidden', 'true')
  })
})
