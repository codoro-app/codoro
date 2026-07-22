import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import {
  CloseIcon,
  CollapseIcon,
  DailyIcon,
  PracticeIcon,
  RatingIcon,
  RushIcon,
  StreakIcon,
} from './Icons'

describe('Icons', () => {
  it.each([
    ['PracticeIcon', PracticeIcon],
    ['DailyIcon', DailyIcon],
    ['RushIcon', RushIcon],
    ['CollapseIcon', CollapseIcon],
    ['CloseIcon', CloseIcon],
    ['RatingIcon', RatingIcon],
    ['StreakIcon', StreakIcon],
  ])('%s renders an aria-hidden svg sized by the size prop', (_name, Icon) => {
    const { container } = render(<Icon size={32} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('width', '32')
    expect(svg).toHaveAttribute('height', '32')
  })

  it('defaults size to 20 when omitted', () => {
    const { container } = render(<PracticeIcon />)
    expect(container.querySelector('svg')).toHaveAttribute('width', '20')
  })
})
