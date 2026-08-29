import { describe, expect, it } from 'vitest'
import { authoringRuleViolations } from './authorScrubberPuzzles'

function checkpoint(question: 'next-line' | 'var-value' | 'output') {
  return { afterStep: 0, question, choices: ['0', '1'], correct: 0 }
}

describe('authoringRuleViolations (Daily-hard batch: 6-8 checkpoints)', () => {
  it('accepts 6 checkpoints with 2 distinct question types', () => {
    const checkpoints = [
      checkpoint('var-value'),
      checkpoint('var-value'),
      checkpoint('var-value'),
      checkpoint('var-value'),
      checkpoint('var-value'),
      checkpoint('output'),
    ]
    expect(authoringRuleViolations(checkpoints)).toBeNull()
  })

  it('accepts 8 checkpoints with 2 distinct question types', () => {
    const checkpoints = Array.from({ length: 7 }, () => checkpoint('var-value')).concat([
      checkpoint('output'),
    ])
    expect(authoringRuleViolations(checkpoints)).toBeNull()
  })

  it('rejects 5 checkpoints (below the new 6-checkpoint floor)', () => {
    const checkpoints = Array.from({ length: 4 }, () => checkpoint('var-value')).concat([
      checkpoint('output'),
    ])
    expect(authoringRuleViolations(checkpoints)).toBe('expected 6-8 checkpoints, got 5')
  })

  it('rejects 9 checkpoints (above the ceiling)', () => {
    const checkpoints = Array.from({ length: 8 }, () => checkpoint('var-value')).concat([
      checkpoint('output'),
    ])
    expect(authoringRuleViolations(checkpoints)).toBe('expected 6-8 checkpoints, got 9')
  })
})
