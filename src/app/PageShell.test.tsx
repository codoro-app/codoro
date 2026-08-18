import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageShell } from './PageShell'

describe('PageShell', () => {
  it('always renders children', () => {
    render(
      <PageShell>
        <p>Body content</p>
      </PageShell>,
    )
    expect(screen.getByText('Body content')).toBeInTheDocument()
  })

  it('renders header content, pinned via sticky positioning, when provided', () => {
    const { container } = render(
      <PageShell header={<p>Header content</p>}>
        <p>Body content</p>
      </PageShell>,
    )
    const headerEl = screen.getByText('Header content')
    expect(headerEl.closest('.sticky.top-0')).not.toBeNull()
    expect(container.querySelectorAll('.sticky.top-0')).toHaveLength(1)
  })

  it('renders no sticky top-0 wrapper when header is omitted', () => {
    const { container } = render(
      <PageShell>
        <p>Body content</p>
      </PageShell>,
    )
    expect(container.querySelector('.sticky.top-0')).toBeNull()
  })

  it('renders stickyAction content, pinned to the bottom with a mobile offset clear of the fixed BottomNav, when provided', () => {
    const { container } = render(
      <PageShell stickyAction={<button type="button">Continue</button>}>
        <p>Body content</p>
      </PageShell>,
    )
    const wrapper = screen.getByRole('button', { name: 'Continue' }).closest('.sticky')
    expect(wrapper).not.toBeNull()
    // Mobile: offset by --bottom-nav-height so it sits above BottomNav
    // instead of underneath it. Desktop (lg:): flush at 0, no bottom nav.
    expect(wrapper).toHaveClass('bottom-[var(--bottom-nav-height)]', 'lg:bottom-0')
    expect(container.querySelectorAll('.sticky')).toHaveLength(1)
  })

  it('renders no sticky wrapper when stickyAction is omitted', () => {
    const { container } = render(
      <PageShell>
        <p>Body content</p>
      </PageShell>,
    )
    expect(container.querySelector('.sticky')).toBeNull()
  })

  it('applies className to the root element', () => {
    const { container } = render(
      <PageShell className="my-page-class">
        <p>Body content</p>
      </PageShell>,
    )
    expect(container.querySelector('.my-page-class')).toBe(container.firstElementChild)
  })
})
