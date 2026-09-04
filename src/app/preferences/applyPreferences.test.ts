import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../storage'
import type { Preferences } from '../../storage'
import { applyPreferences } from './applyPreferences'

afterEach(() => {
  delete document.documentElement.dataset.appTheme
  delete document.documentElement.dataset.reducedMotion
  delete document.documentElement.dataset.codeFontSize
})

describe('applyPreferences', () => {
  it('sets data-app-theme, data-reduced-motion, and data-code-font-size from the given preferences', () => {
    const preferences: Preferences = {
      timerOnTrace: true,
      reducedMotion: true,
      codeFontSize: 'lg',
      theme: 'blue',
      sound: true,
      autoAdvance: true,
    }
    applyPreferences(preferences)

    expect(document.documentElement.dataset.appTheme).toBe('blue')
    expect(document.documentElement.dataset.reducedMotion).toBe('true')
    expect(document.documentElement.dataset.codeFontSize).toBe('lg')
  })

  it('applying DEFAULT_PREFERENCES sets attributes matching todays shipped behavior', () => {
    applyPreferences(DEFAULT_PREFERENCES)

    expect(document.documentElement.dataset.appTheme).toBe('default')
    expect(document.documentElement.dataset.reducedMotion).toBe('false')
    expect(document.documentElement.dataset.codeFontSize).toBe('md')
  })

  it('does not touch data-timer-on-trace — timerOnTrace is a TraceRunner prop, not a document attribute', () => {
    applyPreferences({ ...DEFAULT_PREFERENCES, timerOnTrace: true })
    expect('timerOnTrace' in document.documentElement.dataset).toBe(false)
  })
})
