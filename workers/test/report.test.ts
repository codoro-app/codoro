import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import app from '../src/index'
import { applyAllMigrations } from './support/migrations'
import type { ApiErrorResponse, ReportResponse } from '../shared/api-types'

// A real puzzle id, read the same way workers/scripts/generatePuzzleIds.mjs
// generates VALID_PUZZLE_IDS -- src/content/puzzles/concurrency/con-001.json
// exists in this repo (confirmed by reading it directly); if content ever
// renames/removes it, this test's "known-good id" case is meant to fail
// loudly, not silently validate against a stale id.
const REAL_PUZZLE_ID = 'con-001'

function post(body: unknown, ip: string) {
  return app.request(
    '/api/report',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify(body),
    },
    env,
  )
}

describe('POST /api/report (T4a)', () => {
  beforeAll(async () => {
    await applyAllMigrations()
  })

  it('accepts a signed-out report for a real puzzle id and stores it', async () => {
    const res = await post(
      { puzzleId: REAL_PUZZLE_ID, reason: 'wrong-answer', appVersion: '1.0.0-test' },
      '198.51.100.1',
    )
    expect(res.status).toBe(201)
    const body: ReportResponse = await res.json()
    expect(body.ok).toBe(true)

    const row = await env.DB.prepare('SELECT * FROM reports WHERE puzzle_id = ?')
      .bind(REAL_PUZZLE_ID)
      .first()
    expect(row?.reason).toBe('wrong-answer')
    expect(row?.app_version).toBe('1.0.0-test')
    expect(typeof row?.id).toBe('string')
    expect(typeof row?.created_at).toBe('number')
    // No PII, structurally: the row has exactly these five columns
    // (migration 0001's DDL) -- no clerk_user_id, no IP, hashed or
    // otherwise, in any form. Asserted against the actual column set
    // returned by D1, not just "the columns I remembered to check".
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ['app_version', 'created_at', 'id', 'puzzle_id', 'reason'].sort(),
    )
  })

  it('rejects a body that is not valid JSON', async () => {
    const res = await app.request(
      '/api/report',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.2' },
        body: 'not json',
      },
      env,
    )
    expect(res.status).toBe(400)
  })

  it('rejects a missing field', async () => {
    const res = await post({ reason: 'wrong-answer', appVersion: '1.0.0-test' }, '198.51.100.3')
    expect(res.status).toBe(400)
  })

  it('rejects an out-of-enum reason -- no free-text field reaches storage', async () => {
    const res = await post(
      {
        puzzleId: REAL_PUZZLE_ID,
        reason: 'this puzzle is bad and here is why',
        appVersion: '1.0.0-test',
      },
      '198.51.100.4',
    )
    expect(res.status).toBe(400)
    const body: ApiErrorResponse = await res.json()
    expect(body.error).toBeTruthy()

    const row = await env.DB.prepare(
      'SELECT * FROM reports WHERE puzzle_id = ? AND app_version = ?',
    )
      .bind(REAL_PUZZLE_ID, '1.0.0-test')
      .all()
    // Confirms the rejection actually happened before any insert, not just
    // that the response looked like a 400.
    expect(row.results.some((r) => r.reason === 'this puzzle is bad and here is why')).toBe(false)
  })

  it('rejects an unknown puzzle id', async () => {
    const res = await post(
      { puzzleId: 'not-a-real-puzzle-id', reason: 'wrong-answer', appVersion: '1.0.0-test' },
      '198.51.100.5',
    )
    expect(res.status).toBe(400)
  })

  it('is rate limited per IP, independent of the shared default bucket', async () => {
    const ip = '198.51.100.6'
    // vitest.config.ts's RATE_LIMITER_REPORT_IP test override is limit: 2,
    // period: 10 -- distinct from the shared RATE_LIMITER_PER_IP's limit: 3,
    // so this specifically proves /api/report uses its own bucket, not the
    // shared default one (which would allow a 3rd request through).
    for (let i = 0; i < 2; i++) {
      const res = await post(
        { puzzleId: REAL_PUZZLE_ID, reason: 'unclear', appVersion: '1.0.0-test' },
        ip,
      )
      expect(res.status).toBe(201)
    }
    const res = await post(
      { puzzleId: REAL_PUZZLE_ID, reason: 'unclear', appVersion: '1.0.0-test' },
      ip,
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
  })

  it('rejection responses never touch the database -- an over-limit request results in no new row', async () => {
    const ip = '198.51.100.7'
    for (let i = 0; i < 2; i++) {
      await post({ puzzleId: REAL_PUZZLE_ID, reason: 'typo', appVersion: 'rate-limit-probe' }, ip)
    }
    await post({ puzzleId: REAL_PUZZLE_ID, reason: 'typo', appVersion: 'rate-limit-probe' }, ip)

    const rows = await env.DB.prepare('SELECT * FROM reports WHERE app_version = ?')
      .bind('rate-limit-probe')
      .all()
    // Exactly 2 rows -- the two that succeeded before the bucket was
    // exhausted, not 3.
    expect(rows.results).toHaveLength(2)
  })
})
