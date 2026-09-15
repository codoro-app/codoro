import { describe, expect, it } from 'vitest'
import { resolvePuzzleOgHead } from './[id]'

describe('resolvePuzzleOgHead', () => {
  it('returns null for an unknown puzzle id (generic card passthrough)', () => {
    expect(
      resolvePuzzleOgHead('https://getcodoro.com/puzzle/not-a-real-id', 'not-a-real-id'),
    ).toBeNull()
  })

  it('returns null when the request URL itself is unparseable', () => {
    expect(resolvePuzzleOgHead('not a url', 'con-001')).toBeNull()
  })

  it('resolves copy + a query/hash-stripped canonical URL for a real puzzle id', () => {
    const resolved = resolvePuzzleOgHead(
      'https://getcodoro.com/puzzle/con-001?utm_source=x#fragment',
      'con-001',
    )
    expect(resolved).not.toBeNull()
    expect(resolved?.copy.title).toBe('Concurrency & race conditions puzzle — Codoro')
    expect(resolved?.copy.description.length).toBeGreaterThan(0)
    expect(resolved?.canonicalUrl).toBe('https://getcodoro.com/puzzle/con-001')
  })
})
