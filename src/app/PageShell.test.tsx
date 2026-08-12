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

  it('renders stickyAction content, pinned to the bottom, when provided', () => {
    const { container } = render(
      <PageShell stickyAction={<button type="button">Continue</button>}>
        <p>Body content</p>
      </PageShell>,
    )
    expect(screen.getByRole('button', { name: 'Continue' }).closest('.sticky.bottom-0')).not.toBe(
      null,
    )
    expect(container.querySelectorAll('.sticky.bottom-0')).toHaveLength(1)
  })

  it('renders no sticky bottom-0 wrapper when stickyAction is omitted', () => {
    const { container } = render(
      <PageShell>
        <p>Body content</p>
      </PageShell>,
    )
    expect(container.querySelector('.sticky.bottom-0')).toBeNull()
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
