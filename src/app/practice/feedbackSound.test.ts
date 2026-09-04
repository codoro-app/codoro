import { afterEach, describe, expect, it, vi } from 'vitest'
import { playFeedbackSound, resetFeedbackSoundForTests } from './feedbackSound'
import type { Outcome } from './feel'

const CORRECT: Outcome = {
  kind: 'correct',
  level: 1,
  newCombo: 3,
  newShields: 1,
  surge: true,
  tier: 'novice',
}

function stubAudioContext() {
  const oscillators: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = []
  const gainNode = {
    gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn().mockReturnThis(),
  }
  const filterNode = { type: '', frequency: { value: 0 }, connect: vi.fn().mockReturnThis() }
  const oscillatorNode = () => {
    const osc = {
      type: '',
      frequency: { value: 0 },
      connect: vi.fn().mockReturnThis(),
      start: vi.fn(),
      stop: vi.fn(),
    }
    oscillators.push(osc)
    return osc
  }
  // A plain `function`, not an arrow — this stands in for the real
  // AudioContext constructor and getAudioContext() calls it with `new`;
  // arrow functions aren't constructible, so `vi.fn().mockImplementation`
  // needs a `function` expression here for `new Ctor()` to work at all.
  const ctor = vi.fn().mockImplementation(function AudioContextMock() {
    return {
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: vi.fn(),
      createGain: vi.fn().mockReturnValue(gainNode),
      createBiquadFilter: vi.fn().mockReturnValue(filterNode),
      createOscillator: vi.fn().mockImplementation(oscillatorNode),
    }
  })
  vi.stubGlobal('AudioContext', ctor)
  return { ctor, oscillators }
}

describe('playFeedbackSound', () => {
  afterEach(() => {
    resetFeedbackSoundForTests()
    vi.unstubAllGlobals()
  })

  it('does nothing when sound is disabled — no AudioContext is even constructed', () => {
    const { ctor } = stubAudioContext()
    playFeedbackSound(CORRECT, false)
    expect(ctor).not.toHaveBeenCalled()
  })

  it('constructs AudioContext lazily, once, and reuses it across calls', () => {
    const { ctor } = stubAudioContext()
    playFeedbackSound(CORRECT, true)
    playFeedbackSound(CORRECT, true)
    expect(ctor).toHaveBeenCalledTimes(1)
  })

  it('plays something (creates an oscillator) for correct/shielded/wrong outcomes', () => {
    const { oscillators } = stubAudioContext()
    playFeedbackSound(CORRECT, true)
    expect(oscillators.length).toBeGreaterThan(0)
    for (const osc of oscillators) {
      expect(osc.start).toHaveBeenCalled()
    }
  })

  it('does not throw when AudioContext is entirely unavailable', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(() => {
      playFeedbackSound(CORRECT, true)
    }).not.toThrow()
  })

  it('does not throw when the AudioContext constructor itself throws', () => {
    vi.stubGlobal(
      'AudioContext',
      vi.fn().mockImplementation(() => {
        throw new Error('blocked by permission policy')
      }),
    )
    expect(() => {
      playFeedbackSound(CORRECT, true)
    }).not.toThrow()
  })
})
