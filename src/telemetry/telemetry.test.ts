import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttemptEventPayload } from './events'

/**
 * posthog-js is mocked at the module boundary — these tests assert the
 * *contract* (exact event name + property shape, silent no-op behavior),
 * never hit a real network endpoint.
 *
 * env.ts computes `env` once at import time from `import.meta.env`, so to
 * exercise both "key set" and "key unset" in one file we re-mock `../env`
 * per test with `vi.doMock` + `vi.resetModules()` and re-import the module
 * under test dynamically — a fresh module graph per test, same pattern
 * needed anywhere a config singleton is read at import time.
 *
 * client.ts now loads posthog-js via a dynamic `import()` (see the comment
 * there for why) instead of a static one, so init/capture calls resolve
 * over a microtask hop or two rather than synchronously. `flushPromises()`
 * drains the queue with a macrotask (a real `setTimeout`, not another
 * microtask), which is resilient to the exact number of internal `.then()`
 * hops — every test that asserts a `posthogMock` call actually happened
 * awaits it first.
 */

const posthogMock = {
  init: vi.fn(),
  capture: vi.fn(),
}

vi.mock('posthog-js', () => ({ default: posthogMock }))

beforeEach(() => {
  vi.resetModules()
  posthogMock.init.mockReset()
  posthogMock.capture.mockReset()
})

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function loadTelemetry(key: string | undefined, host = 'https://us.i.posthog.com') {
  vi.doMock('../env', () => ({
    env: { VITE_POSTHOG_KEY: key, VITE_POSTHOG_HOST: host },
  }))
  return import('./index')
}

const attemptPayload: AttemptEventPayload = {
  puzzle_id: 'cf-001',
  correct: true,
  time_ms: 4200,
  mode: 'practice',
  interaction: 'mcq',
  user_rating_before: 1100,
  user_rating_after: 1115,
}

describe('initTelemetry', () => {
  it('calls posthog.init with the configured key and host when a key is present', async () => {
    const { initTelemetry } = await loadTelemetry('phc_test_key', 'https://eu.i.posthog.com')
    initTelemetry()
    await flushPromises()
    expect(posthogMock.init).toHaveBeenCalledTimes(1)
    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_test_key',
      expect.objectContaining({ api_host: 'https://eu.i.posthog.com' }),
    )
  })

  it('no-ops without calling posthog.init when the key is unset', async () => {
    const { initTelemetry } = await loadTelemetry(undefined)
    initTelemetry()
    await flushPromises()
    expect(posthogMock.init).not.toHaveBeenCalled()
  })

  it('does not throw when posthog.init itself throws', async () => {
    posthogMock.init.mockImplementation(() => {
      throw new Error('blocked by ad-blocker')
    })
    const { initTelemetry } = await loadTelemetry('phc_test_key')
    expect(() => {
      initTelemetry()
    }).not.toThrow()
    await flushPromises()
  })
})

describe('trackSessionStart', () => {
  it('captures session_start with no required custom properties', async () => {
    const { trackSessionStart } = await loadTelemetry('phc_test_key')
    trackSessionStart()
    await flushPromises()
    expect(posthogMock.capture).toHaveBeenCalledWith('session_start', undefined)
  })

  it('no-ops without calling posthog.capture when the key is unset', async () => {
    const { trackSessionStart } = await loadTelemetry(undefined)
    trackSessionStart()
    await flushPromises()
    expect(posthogMock.capture).not.toHaveBeenCalled()
  })

  it('does not throw when posthog.capture itself throws', async () => {
    posthogMock.capture.mockImplementation(() => {
      throw new Error('network blocked')
    })
    const { trackSessionStart } = await loadTelemetry('phc_test_key')
    expect(() => {
      trackSessionStart()
    }).not.toThrow()
    await flushPromises()
  })
})

describe('trackAttempt', () => {
  it('captures attempt with exactly the locked property shape', async () => {
    const { trackAttempt } = await loadTelemetry('phc_test_key')
    trackAttempt(attemptPayload)
    await flushPromises()
    expect(posthogMock.capture).toHaveBeenCalledWith('attempt', attemptPayload)
  })

  it('no-ops without calling posthog.capture when the key is unset', async () => {
    const { trackAttempt } = await loadTelemetry(undefined)
    trackAttempt(attemptPayload)
    await flushPromises()
    expect(posthogMock.capture).not.toHaveBeenCalled()
  })

  it('does not throw when posthog.capture itself throws', async () => {
    posthogMock.capture.mockImplementation(() => {
      throw new Error('network blocked')
    })
    const { trackAttempt } = await loadTelemetry('phc_test_key')
    expect(() => {
      trackAttempt(attemptPayload)
    }).not.toThrow()
    await flushPromises()
  })
})

describe('trackRushAttempt', () => {
  it('captures the "attempt" event with the locked shape plus run-level context', async () => {
    const { trackRushAttempt } = await loadTelemetry('phc_test_key')
    const payload = {
      ...attemptPayload,
      mode: 'rush' as const,
      run_id: 'run-1',
      position_in_run: 4,
      difficulty_served: 880,
    }
    trackRushAttempt(payload)
    await flushPromises()
    expect(posthogMock.capture).toHaveBeenCalledWith('attempt', payload)
  })

  it('no-ops without calling posthog.capture when the key is unset', async () => {
    const { trackRushAttempt } = await loadTelemetry(undefined)
    trackRushAttempt({
      ...attemptPayload,
      mode: 'rush',
      run_id: 'run-1',
      position_in_run: 1,
      difficulty_served: 800,
    })
    await flushPromises()
    expect(posthogMock.capture).not.toHaveBeenCalled()
  })
})

describe('trackRushRunEnd', () => {
  it('captures rush_run_end with the exact payload shape', async () => {
    const { trackRushRunEnd } = await loadTelemetry('phc_test_key')
    const payload = {
      run_id: 'run-1',
      solved_count: 23,
      best_streak_in_run: 31,
      final_difficulty: 1600,
    }
    trackRushRunEnd(payload)
    await flushPromises()
    expect(posthogMock.capture).toHaveBeenCalledWith('rush_run_end', payload)
  })

  it('no-ops without calling posthog.capture when the key is unset', async () => {
    const { trackRushRunEnd } = await loadTelemetry(undefined)
    trackRushRunEnd({
      run_id: 'run-1',
      solved_count: 0,
      best_streak_in_run: 0,
      final_difficulty: 800,
    })
    await flushPromises()
    expect(posthogMock.capture).not.toHaveBeenCalled()
  })
})

describe('trackPuzzleLinkView', () => {
  it('captures puzzle_link_view with the exact property shape for a found puzzle', async () => {
    const { trackPuzzleLinkView } = await loadTelemetry('phc_test_key')
    const payload = { puzzle_id: 'tc-009', interaction: 'scrubber' as const, found: true }
    trackPuzzleLinkView(payload)
    await flushPromises()
    expect(posthogMock.capture).toHaveBeenCalledWith('puzzle_link_view', payload)
  })

  it('captures found: false with a null interaction for an unresolvable id', async () => {
    const { trackPuzzleLinkView } = await loadTelemetry('phc_test_key')
    const payload = { puzzle_id: 'nonsense-id', interaction: null, found: false }
    trackPuzzleLinkView(payload)
    await flushPromises()
    expect(posthogMock.capture).toHaveBeenCalledWith('puzzle_link_view', payload)
  })

  it('no-ops without calling posthog.capture when the key is unset', async () => {
    const { trackPuzzleLinkView } = await loadTelemetry(undefined)
    trackPuzzleLinkView({ puzzle_id: 'tc-009', interaction: 'scrubber', found: true })
    await flushPromises()
    expect(posthogMock.capture).not.toHaveBeenCalled()
  })
})

describe('trackPuzzleLinkAttempt', () => {
  it('captures puzzle_link_attempt with the exact property shape', async () => {
    const { trackPuzzleLinkAttempt } = await loadTelemetry('phc_test_key')
    const payload = {
      puzzle_id: 'cf-001',
      interaction: 'mcq' as const,
      correct: true,
      time_ms: 3100,
    }
    trackPuzzleLinkAttempt(payload)
    await flushPromises()
    expect(posthogMock.capture).toHaveBeenCalledWith('puzzle_link_attempt', payload)
  })

  it('no-ops without calling posthog.capture when the key is unset', async () => {
    const { trackPuzzleLinkAttempt } = await loadTelemetry(undefined)
    trackPuzzleLinkAttempt({
      puzzle_id: 'cf-001',
      interaction: 'mcq',
      correct: false,
      time_ms: 500,
    })
    await flushPromises()
    expect(posthogMock.capture).not.toHaveBeenCalled()
  })
})

describe('trackShareClick', () => {
  it('captures share_click with the exact property shape', async () => {
    const { trackShareClick } = await loadTelemetry('phc_test_key')
    const payload = { surface: 'practice' as const, puzzle_id: 'cf-001' }
    trackShareClick(payload)
    await flushPromises()
    expect(posthogMock.capture).toHaveBeenCalledWith('share_click', payload)
  })

  it('no-ops without calling posthog.capture when the key is unset', async () => {
    const { trackShareClick } = await loadTelemetry(undefined)
    trackShareClick({ surface: 'daily', puzzle_id: 'cf-001' })
    await flushPromises()
    expect(posthogMock.capture).not.toHaveBeenCalled()
  })
})

describe('trackError', () => {
  it('captures an error event with message, stack, and context', async () => {
    const { trackError } = await loadTelemetry('phc_test_key')
    const error = new Error('boom')
    trackError(error, 'ErrorBoundary')
    await flushPromises()
    expect(posthogMock.capture).toHaveBeenCalledTimes(1)
    const [eventName, properties] = posthogMock.capture.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(eventName).toBe('app_error')
    expect(properties).toMatchObject({ message: 'boom', context: 'ErrorBoundary' })
    expect(typeof properties.stack).toBe('string')
  })

  it('handles non-Error thrown values without throwing', async () => {
    const { trackError } = await loadTelemetry('phc_test_key')
    expect(() => {
      trackError('a plain string was thrown')
    }).not.toThrow()
    await flushPromises()
    expect(posthogMock.capture).toHaveBeenCalledWith(
      'app_error',
      expect.objectContaining({ message: 'a plain string was thrown' }),
    )
  })

  it('truncates an overlong message and stack instead of sending them unbounded', async () => {
    const { trackError } = await loadTelemetry('phc_test_key')
    const error = new Error('x'.repeat(10_000))
    error.stack = 'y'.repeat(10_000)
    trackError(error)
    await flushPromises()
    const [, properties] = posthogMock.capture.mock.calls[0] as [string, Record<string, unknown>]
    expect((properties.message as string).length).toBeLessThan(10_000)
    expect((properties.stack as string).length).toBeLessThan(10_000)
  })

  it('no-ops without calling posthog.capture when the key is unset', async () => {
    const { trackError } = await loadTelemetry(undefined)
    trackError(new Error('boom'))
    await flushPromises()
    expect(posthogMock.capture).not.toHaveBeenCalled()
  })

  it('does not throw when posthog.capture itself throws', async () => {
    posthogMock.capture.mockImplementation(() => {
      throw new Error('network blocked')
    })
    const { trackError } = await loadTelemetry('phc_test_key')
    expect(() => {
      trackError(new Error('boom'))
    }).not.toThrow()
    await flushPromises()
  })
})
