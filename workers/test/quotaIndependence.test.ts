import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { getAllTimeLeaderboard, insertUser, recordScore } from '../src/db'
import { applyAllMigrations } from './support/migrations'

// T4's plan text is explicit that the ratelimits binding does *burst
// damping* only -- "every exact quota is enforced in D1 where the
// constraint already lives" -- and requires a test proving the D1-enforced
// quotas hold "with the limiter disabled". This file is that test.
//
// There is no literal "disable the limiter" switch to flip (nothing in
// src/db.ts imports src/rateLimit.ts or touches RATE_LIMITER_PER_IP/
// RATE_LIMITER_PER_USER at all), which is itself the property being
// proven: db.ts's quota -- "one scores row per user per mode per day",
// scores' own PRIMARY KEY, migration 0001 -- is enforced by SQLite's
// constraint machinery inside recordScore()'s D1 batch(), not by anything
// this task added. This test calls recordScore() directly, with no Worker,
// no Hono app, and no rate-limit middleware anywhere on the call path, so
// there is nothing here that *could* be coupling the two.
describe('D1-enforced quotas hold independent of the rate limiter (T4)', () => {
  it('recordScore enforces its one-row-per-user-per-mode-per-day quota with no rate limiter on the call path', async () => {
    await applyAllMigrations()
    await insertUser(env.DB, { clerk_user_id: 'quota_player', created_at: Date.now() })

    // Same user, same mode, same day, submitted three times -- if this were
    // rate-limiter-enforced, three rapid calls in a real request path would
    // 429 before ever reaching D1. Called directly like this, all three
    // reach recordScore() unconditionally; the quota still holds because
    // it's the PRIMARY KEY doing the work, not a request-rate check.
    await recordScore(env.DB, {
      clerkUserId: 'quota_player',
      mode: 'rush',
      day: '2026-09-10',
      score: 10,
      now: Date.now(),
    })
    await recordScore(env.DB, {
      clerkUserId: 'quota_player',
      mode: 'rush',
      day: '2026-09-10',
      score: 999,
      now: Date.now(),
    })
    await recordScore(env.DB, {
      clerkUserId: 'quota_player',
      mode: 'rush',
      day: '2026-09-10',
      score: 5,
      now: Date.now(),
    })

    const rows = await env.DB.prepare(
      'SELECT score FROM scores WHERE clerk_user_id = ? AND mode = ? AND day = ?',
    )
      .bind('quota_player', 'rush', '2026-09-10')
      .all()
    // Still exactly one row for the (user, mode, day) key -- the quota --
    // and it kept the best of the three scores (keep-best, S3), not the
    // last write. Neither behavior came from anything rate-limit-related.
    expect(rows.results).toHaveLength(1)
    expect(rows.results[0]?.score).toBe(999)

    const board = await getAllTimeLeaderboard(env.DB, 'rush')
    expect(board.filter((row) => row.clerk_user_id === 'quota_player')).toHaveLength(1)
  })
})
