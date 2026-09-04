import { describe, expect, it, vi } from 'vitest'
import { playImpact } from './playImpact'
import * as haptics from './haptics'
import * as feedbackSound from './feedbackSound'
import type { Outcome } from './feel'
import { DEFAULT_PREFERENCES } from '../../storage'

const WRONG: Outcome = { kind: 'wrong', newCombo: 0, newShields: 0, tier: 'novice' }

describe('playImpact', () => {
  it('calls hapticImpact unconditionally (haptics have no preference gate)', () => {
    const hapticSpy = vi.spyOn(haptics, 'hapticImpact').mockImplementation(() => undefined)
    vi.spyOn(feedbackSound, 'playFeedbackSound').mockImplementation(() => undefined)
    playImpact(WRONG, DEFAULT_PREFERENCES)
    expect(hapticSpy).toHaveBeenCalledWith(WRONG)
  })

  it('calls playFeedbackSound with the sound preference', () => {
    vi.spyOn(haptics, 'hapticImpact').mockImplementation(() => undefined)
    const soundSpy = vi
      .spyOn(feedbackSound, 'playFeedbackSound')
      .mockImplementation(() => undefined)
    playImpact(WRONG, { ...DEFAULT_PREFERENCES, sound: false })
    expect(soundSpy).toHaveBeenCalledWith(WRONG, false)
  })
})
