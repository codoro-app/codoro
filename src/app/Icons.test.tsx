import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import {
  BossIcon,
  CloseIcon,
  CollapseIcon,
  CopyIcon,
  DailyIcon,
  HomeIcon,
  PracticeIcon,
  RatingIcon,
  RushIcon,
  ShareIcon,
  StreakIcon,
  TraceIcon,
} from './Icons'

describe('Icons', () => {
  it.each([
    ['PracticeIcon', PracticeIcon],
    ['DailyIcon', DailyIcon],
    ['RushIcon', RushIcon],
    ['BossIcon', BossIcon],
    ['TraceIcon', TraceIcon],
    ['HomeIcon', HomeIcon],
    ['CollapseIcon', CollapseIcon],
    ['CloseIcon', CloseIcon],
    ['RatingIcon', RatingIcon],
    ['StreakIcon', StreakIcon],
    ['ShareIcon', ShareIcon],
    ['CopyIcon', CopyIcon],
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
