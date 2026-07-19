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
    expect(posthogMock.init).toHaveBeenCalledTimes(1)
    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_test_key',
      expect.objectContaining({ api_host: 'https://eu.i.posthog.com' }),
    )
  })

  it('no-ops without calling posthog.init when the key is unset', async () => {
    const { initTelemetry } = await loadTelemetry(undefined)
    initTelemetry()
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
  })
})

describe('trackSessionStart', () => {
  it('captures session_start with no required custom properties', async () => {
    const { trackSessionStart } = await loadTelemetry('phc_test_key')
    trackSessionStart()
    expect(posthogMock.capture).toHaveBeenCalledWith('session_start', undefined)
  })

  it('no-ops without calling posthog.capture when the key is unset', async () => {
    const { trackSessionStart } = await loadTelemetry(undefined)
    trackSessionStart()
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
  })
})

describe('trackAttempt', () => {
  it('captures attempt with exactly the locked property shape', async () => {
    const { trackAttempt } = await loadTelemetry('phc_test_key')
    trackAttempt(attemptPayload)
    expect(posthogMock.capture).toHaveBeenCalledWith('attempt', attemptPayload)
  })

  it('no-ops without calling posthog.capture when the key is unset', async () => {
    const { trackAttempt } = await loadTelemetry(undefined)
    trackAttempt(attemptPayload)
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
  })
})

describe('trackError', () => {
  it('captures an error event with message, stack, and context', async () => {
    const { trackError } = await loadTelemetry('phc_test_key')
    const error = new Error('boom')
    trackError(error, 'ErrorBoundary')
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
    const [, properties] = posthogMock.capture.mock.calls[0] as [string, Record<string, unknown>]
    expect((properties.message as string).length).toBeLessThan(10_000)
    expect((properties.stack as string).length).toBeLessThan(10_000)
  })

  it('no-ops without calling posthog.capture when the key is unset', async () => {
    const { trackError } = await loadTelemetry(undefined)
    trackError(new Error('boom'))
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
  })
})
