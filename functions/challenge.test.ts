import { describe, expect, it } from 'vitest'
import { buildChallengeOgCopy, resolveChallengeOgHead, sanitizeOgName } from './challenge'
import { buildChallengeOgParam } from '../src/challenge'

describe('sanitizeOgName', () => {
  it('strips control characters', () => {
    // String.fromCharCode, not a literal control byte in this source file —
    // keeps the test file itself free of raw non-printable bytes.
    const withControlChar = `Jo${String.fromCharCode(7)}e`
    expect(sanitizeOgName(withControlChar)).toBe('Joe')
  })

  it('caps at 40 characters, defense in depth on top of the schema bound', () => {
    expect(sanitizeOgName('x'.repeat(50))).toBe('x'.repeat(40))
  })

  it('leaves an already-clean name untouched', () => {
    expect(sanitizeOgName('Joe')).toBe('Joe')
  })
})

describe('buildChallengeOgCopy', () => {
  it('builds named, plural copy', () => {
    expect(buildChallengeOgCopy({ n: 'Joe', c: 3 })).toEqual({
      title: 'Joe challenges you — 3 puzzles',
      description: "Beat Joe's time on 3 coding puzzles. No account needed.",
    })
  })

  it('builds named, singular copy for a single puzzle', () => {
    expect(buildChallengeOgCopy({ n: 'Joe', c: 1 })).toEqual({
      title: 'Joe challenges you — 1 puzzle',
      description: "Beat Joe's time on 1 coding puzzle. No account needed.",
    })
  })

  it('builds anonymous, plural copy when the name is null', () => {
    expect(buildChallengeOgCopy({ n: null, c: 5 })).toEqual({
      title: 'A friend challenges you — 5 puzzles',
      description: 'Beat their time on 5 coding puzzles. No account needed.',
    })
  })

  it('builds anonymous, singular copy for a single puzzle', () => {
    expect(buildChallengeOgCopy({ n: null, c: 1 })).toEqual({
      title: 'A friend challenges you — 1 puzzle',
      description: 'Beat their time on 1 coding puzzle. No account needed.',
    })
  })

  it('falls back to anonymous copy when a name sanitizes down to nothing (all control characters)', () => {
    const allControlChars = String.fromCharCode(0) + String.fromCharCode(1)
    expect(buildChallengeOgCopy({ n: allControlChars, c: 2 })).toEqual({
      title: 'A friend challenges you — 2 puzzles',
      description: 'Beat their time on 2 coding puzzles. No account needed.',
    })
  })
})

describe('resolveChallengeOgHead', () => {
  it('returns null when there is no og param at all', () => {
    expect(resolveChallengeOgHead('https://getcodoro.com/challenge#somefragment')).toBeNull()
  })

  it("returns null when the og param fails to decode (matches the codec's reject-wholesale contract)", () => {
    expect(
      resolveChallengeOgHead('https://getcodoro.com/challenge?og=not-valid-base64!!!'),
    ).toBeNull()
  })

  it('returns null when the request URL itself is unparseable', () => {
    expect(resolveChallengeOgHead('not a url')).toBeNull()
  })

  it('resolves copy + a query-stripped canonical URL for a valid og param', () => {
    const og = buildChallengeOgParam('Joe', 2)
    const resolved = resolveChallengeOgHead(
      `https://getcodoro.com/challenge?og=${og}#fragmentstuff`,
    )
    expect(resolved).toEqual({
      copy: {
        title: 'Joe challenges you — 2 puzzles',
        description: "Beat Joe's time on 2 coding puzzles. No account needed.",
      },
      canonicalUrl: 'https://getcodoro.com/challenge',
    })
  })

  it('resolves the anonymous fallback when the payload carries a null name', () => {
    const og = buildChallengeOgParam(null, 1)
    const resolved = resolveChallengeOgHead(`https://getcodoro.com/challenge?og=${og}`)
    expect(resolved?.copy).toEqual({
      title: 'A friend challenges you — 1 puzzle',
      description: 'Beat their time on 1 coding puzzle. No account needed.',
    })
  })
})
