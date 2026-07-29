import { beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { useRouteMeta } from './useRouteMeta'

function TestHarness() {
  useRouteMeta()
  return null
}

function descriptionContent(): string | null {
  return document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null
}

describe('useRouteMeta', () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta name="description" content="placeholder">'
    document.title = 'placeholder'
  })

  it('sets the title and description for a known route', () => {
    window.history.pushState({}, '', '/practice')
    render(<TestHarness />)

    expect(document.title).toBe('Practice — Codoro')
    expect(descriptionContent()).toBe('Endless rating-matched coding puzzles, one bug at a time.')
  })

  it('updates on navigation', () => {
    window.history.pushState({}, '', '/practice')
    render(<TestHarness />)
    expect(document.title).toBe('Practice — Codoro')

    window.history.pushState({}, '', '/legal')
    render(<TestHarness />)
    expect(document.title).toBe('Terms & privacy — Codoro')
    expect(descriptionContent()).toBe("Codoro's terms of use and privacy notice.")
  })

  it('falls back to the 404 title for an unmatched path, without touching the description', () => {
    window.history.pushState({}, '', '/nonsense')
    render(<TestHarness />)

    expect(document.title).toBe('Page not found — Codoro')
    expect(descriptionContent()).toBe('placeholder')
  })
})
