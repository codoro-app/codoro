import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { DuckMark, DuckMascot } from './Mascot'

describe('DuckMark', () => {
  it('renders an svg sized to the given size prop', () => {
    const { container } = render(<DuckMark size={40} />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '40')
    expect(svg).toHaveAttribute('height', '40')
  })

  it('defaults to size 28 when no size is passed', () => {
    const { container } = render(<DuckMark />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '28')
    expect(svg).toHaveAttribute('height', '28')
  })
})

describe('DuckMascot', () => {
  it.each(['idle', 'happy', 'debugging', 'sad'] as const)(
    'renders the %s pose without throwing',
    (pose) => {
      const { container } = render(<DuckMascot pose={pose} />)
      expect(container.querySelector('svg')).toBeInTheDocument()
    },
  )
})
