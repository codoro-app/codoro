import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressIndicator } from './ProgressIndicator'

describe('ProgressIndicator variant="dots"', () => {
  it('marks dots done/current/upcoming relative to value, for the default accent tone', () => {
    render(<ProgressIndicator value={2} max={3} variant="dots" />)
    const dots = screen.getAllByTestId('progress-dot')
    expect(dots).toHaveLength(3)
    expect(dots[0]).toHaveAttribute('data-state', 'done')
    expect(dots[1]).toHaveAttribute('data-state', 'current')
    expect(dots[2]).toHaveAttribute('data-state', 'upcoming')
  })

  it('renders a simple filled/empty split for the danger tone (lives/strikes), no current state', () => {
    render(<ProgressIndicator value={1} max={3} variant="dots" tone="danger" />)
    const dots = screen.getAllByTestId('progress-dot')
    expect(dots[0]).toHaveAttribute('data-state', 'done')
    expect(dots[1]).toHaveAttribute('data-state', 'upcoming')
    expect(dots[2]).toHaveAttribute('data-state', 'upcoming')
  })

  it('exposes role="status" with the given label by default', () => {
    render(
      <ProgressIndicator value={1} max={3} variant="dots" tone="danger" label="1 of 3 strikes" />,
    )
    expect(screen.getByRole('status', { name: '1 of 3 strikes' })).toBeInTheDocument()
  })

  it('is aria-hidden and has no accessible name when no label is given', () => {
    render(<ProgressIndicator value={1} max={3} variant="dots" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('ProgressIndicator variant="bar"', () => {
  it('fills proportionally to value/max', () => {
    render(<ProgressIndicator value={1} max={4} variant="bar" label="loading" />)
    const fill = screen.getByTestId('progress-fill')
    expect(fill).toHaveStyle({ width: '25%' })
  })

  it('uses role="status" by default (infrequent changes, e.g. a health meter)', () => {
    render(<ProgressIndicator value={2} max={3} variant="bar" label="2 of 3 strikes" />)
    expect(screen.getByRole('status', { name: '2 of 3 strikes' })).toBeInTheDocument()
  })

  it('uses role="progressbar" with numeric value attrs when announceAs="progressbar" (continuously-ticking values)', () => {
    render(
      <ProgressIndicator
        value={1500}
        max={3000}
        variant="bar"
        label="Time remaining"
        announceAs="progressbar"
      />,
    )
    const bar = screen.getByRole('progressbar', { name: 'Time remaining' })
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '3000')
    expect(bar).toHaveAttribute('aria-valuenow', '1500')
  })
})
