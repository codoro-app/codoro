import { describe, expect, it } from 'vitest'
import {
  buildChallengePayload,
  buildChallengeUrl,
  decodeChallengePayload,
  truncateToChallengeLimit,
} from './codec'
import { CHALLENGE_PAYLOAD_VERSION, MAX_CHALLENGE_PUZZLES } from './schema'
import type { ChallengeAttemptInput, ChallengePayload } from './schema'

const sampleAttempts: ChallengeAttemptInput[] = [
  { puzzleId: 'con-005', correct: true, time_ms: 4200 },
  { puzzleId: 'cf-001', correct: false, time_ms: 3100 },
  { puzzleId: 'tc-009', correct: true, time_ms: 5200 },
]

/** Extracts the fragment content (encoded string, no '#') from a built challenge URL. */
function fragmentOf(payload: ChallengePayload): string {
  return buildChallengeUrl(payload).split('#')[1] ?? ''
}

/** Round-trips a payload through encode -> decode, asserting it survives. */
function roundTrip(payload: ChallengePayload): ChallengePayload {
  const decoded = decodeChallengePayload(fragmentOf(payload))
  if (!decoded) throw new Error('expected a round-tripped payload')
  return decoded
}

/** Encodes raw text as base64url (test-only helper, mirrors the codec's own alphabet). */
function base64urlOf(text: string): string {
  let binary = ''
  for (let i = 0; i < text.length; i++) binary += String.fromCharCode(text.charCodeAt(i) & 0xff)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

describe('decodeChallengePayload — round trip', () => {
  it('round-trips an exact payload through encode -> decode', () => {
    const payload: ChallengePayload = {
      v: CHALLENGE_PAYLOAD_VERSION,
      ids: ['con-005', 'cf-001', 'tc-009'],
      results: [
        { correct: true, time_ms: 4200 },
        { correct: false, time_ms: 3100 },
        { correct: true, time_ms: 5200 },
      ],
      totalMs: 12500,
    }
    expect(roundTrip(payload)).toEqual(payload)
  })

  it('round-trips a single-puzzle challenge', () => {
    const payload: ChallengePayload = {
      v: CHALLENGE_PAYLOAD_VERSION,
      ids: ['con-005'],
      results: [{ correct: true, time_ms: 9900 }],
      totalMs: 9900,
    }
    expect(roundTrip(payload)).toEqual(payload)
  })

  it('encodes to URL-safe base64url — no +, /, or = padding in the fragment', () => {
    const encoded = fragmentOf(buildChallengePayload(sampleAttempts))
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')
  })
})

describe('decodeChallengePayload — failure modes collapse to null', () => {
  it('rejects characters outside the base64url alphabet (corrupted base64)', () => {
    expect(decodeChallengePayload('!!!not-base64!!!')).toBeNull()
    expect(decodeChallengePayload('abc def')).toBeNull()
  })

  it('rejects a truncated payload (valid base64url whose content is truncated JSON)', () => {
    expect(decodeChallengePayload(base64urlOf('{"v"'))).toBeNull()
  })

  it('rejects truncated UTF-8 (a cut multi-byte sequence)', () => {
    // '😀' is F0 9F 98 80 in UTF-8; the first three bytes are an incomplete
    // 4-byte sequence, which the codec's fatal TextDecoder rejects.
    let binary = ''
    for (const byte of [0xf0, 0x9f, 0x98]) binary += String.fromCharCode(byte)
    expect(
      decodeChallengePayload(
        btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''),
      ),
    ).toBeNull()
  })

  it('rejects valid base64url that is not JSON', () => {
    expect(decodeChallengePayload(base64urlOf('plain text, not JSON'))).toBeNull()
  })

  it('rejects valid JSON with the wrong shape (missing fields)', () => {
    expect(decodeChallengePayload(base64urlOf('{"v":1,"ids":["con-005"]}'))).toBeNull()
  })

  it('rejects a payload whose ids and results lengths differ', () => {
    const bad = JSON.stringify({
      v: CHALLENGE_PAYLOAD_VERSION,
      ids: ['con-005', 'cf-001'],
      results: [{ correct: true, time_ms: 100 }],
      totalMs: 100,
    })
    expect(decodeChallengePayload(base64urlOf(bad))).toBeNull()
  })

  it('rejects an empty ids array', () => {
    const bad = JSON.stringify({
      v: CHALLENGE_PAYLOAD_VERSION,
      ids: [],
      results: [],
      totalMs: 0,
    })
    expect(decodeChallengePayload(base64urlOf(bad))).toBeNull()
  })

  it('rejects an unknown payload version wholesale', () => {
    const bad = JSON.stringify({
      v: CHALLENGE_PAYLOAD_VERSION + 1,
      ids: ['con-005'],
      results: [{ correct: true, time_ms: 100 }],
      totalMs: 100,
    })
    expect(decodeChallengePayload(base64urlOf(bad))).toBeNull()
  })

  it('rejects an empty fragment', () => {
    expect(decodeChallengePayload('')).toBeNull()
  })
})

describe('truncation (runs longer than MAX_CHALLENGE_PUZZLES)', () => {
  it('truncateToChallengeLimit keeps the last N attempts, not the first', () => {
    const attempts = Array.from({ length: 9 }, (_, i) => ({
      puzzleId: `p${String(i)}`,
      correct: true,
      time_ms: i,
    }))
    expect(truncateToChallengeLimit(attempts).map((a) => a.puzzleId)).toEqual([
      'p4',
      'p5',
      'p6',
      'p7',
      'p8',
    ])
  })

  it('buildChallengePayload truncates a 7-item input to its last 5', () => {
    const attempts = Array.from({ length: 7 }, (_, i) => ({
      puzzleId: `p${String(i)}`,
      correct: i % 2 === 0,
      time_ms: 1000 + i,
    }))
    const payload = buildChallengePayload(attempts)
    expect(payload.ids).toEqual(['p2', 'p3', 'p4', 'p5', 'p6'])
    expect(payload.results).toHaveLength(MAX_CHALLENGE_PUZZLES)
    // totalMs is the sum over the KEPT results — consistent with the ids/results shown.
    expect(payload.totalMs).toBe(1000 + 2 + 1000 + 3 + 1000 + 4 + 1000 + 5 + 1000 + 6)
    // And the truncated payload still round-trips.
    expect(roundTrip(payload).ids).toEqual(['p2', 'p3', 'p4', 'p5', 'p6'])
  })

  it('leaves a run at or under the cap untouched', () => {
    const attempts = Array.from({ length: 3 }, (_, i) => ({
      puzzleId: `p${String(i)}`,
      correct: true,
      time_ms: 100 + i,
    }))
    expect(buildChallengePayload(attempts).ids).toEqual(['p0', 'p1', 'p2'])
  })
})

describe('buildChallengePayload', () => {
  it('derives ids/results/totalMs from accumulated attempts in order', () => {
    const payload = buildChallengePayload(sampleAttempts)
    expect(payload).toEqual({
      v: CHALLENGE_PAYLOAD_VERSION,
      ids: ['con-005', 'cf-001', 'tc-009'],
      results: [
        { correct: true, time_ms: 4200 },
        { correct: false, time_ms: 3100 },
        { correct: true, time_ms: 5200 },
      ],
      totalMs: 12500,
    })
  })
})

describe('buildChallengeUrl', () => {
  it('produces a full shareable /challenge#... URL whose fragment decodes back', () => {
    const payload = buildChallengePayload(sampleAttempts)
    const url = buildChallengeUrl(payload)
    expect(url).toMatch(/^getcodoro\.com\/challenge#/)
    const decoded = decodeChallengePayload(url.split('#')[1] ?? '')
    expect(decoded).toEqual(payload)
  })
})
