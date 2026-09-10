import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { getAllTimeLeaderboard, insertUser, recordScore } from '../src/db'
import { applyAllMigrations } from './support/migrations'

// S3's correctness fix, proved directly: the pre-amendment schema ranked
// the day-keyed `scores` table for window=all, so one strong player with
// many good days occupied multiple top-ten slots. `scores_best` (one row
// per user per mode, PRIMARY KEY (clerk_user_id, mode)) makes that
// structural rather than a GROUP BY bolted on later -- this is the required
// DoD line proving it, not optional polish.

describe('scores / scores_best split (S3)', () => {
  beforeEach(async () => {
    await applyAllMigrations()
  })

  it('keeps exactly one scores_best row per user per mode across many days -- the all-time board has no duplicate user', async () => {
    await insertUser(env.DB, { clerk_user_id: 'player_1', created_at: Date.now() })
    await insertUser(env.DB, { clerk_user_id: 'player_2', created_at: Date.now() })

    // player_1: ten good days on 'rush' -- the exact scenario the amendment
    // names as the bug this split fixes (one strong player occupying
    // multiple top-ten slots under the old single-table all-time index).
    const days = Array.from({ length: 10 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
    for (const [i, day] of days.entries()) {
      await recordScore(env.DB, {
        clerkUserId: 'player_1',
        mode: 'rush',
        day,
        score: 100 + i,
        now: Date.now(),
      })
    }
    await recordScore(env.DB, {
      clerkUserId: 'player_2',
      mode: 'rush',
      day: '2026-09-05',
      score: 500,
      now: Date.now(),
    })

    const board = await getAllTimeLeaderboard(env.DB, 'rush')
    const userIds = board.map((row) => row.clerk_user_id)
    expect(new Set(userIds).size).toBe(userIds.length)
    expect(userIds).toContain('player_1')
    expect(userIds).toContain('player_2')

    // keep-best: player_1's single scores_best row is their max across all
    // ten days (109), not their first, last, or most-recent day's score.
    const player1Best = board.find((row) => row.clerk_user_id === 'player_1')
    expect(player1Best?.score).toBe(109)
  })

  it('a lower score on a later day does not overwrite scores_best (keep-best, not last-write-wins)', async () => {
    await insertUser(env.DB, { clerk_user_id: 'player_3', created_at: Date.now() })
    await recordScore(env.DB, {
      clerkUserId: 'player_3',
      mode: 'boss',
      day: '2026-09-01',
      score: 900,
      now: Date.now(),
    })
    await recordScore(env.DB, {
      clerkUserId: 'player_3',
      mode: 'boss',
      day: '2026-09-02',
      score: 100,
      now: Date.now(),
    })

    const board = await getAllTimeLeaderboard(env.DB, 'boss')
    expect(board.find((row) => row.clerk_user_id === 'player_3')?.score).toBe(900)
  })

  it('the rolling window table keeps a separate row per day -- it is not collapsed like scores_best', async () => {
    await insertUser(env.DB, { clerk_user_id: 'player_4', created_at: Date.now() })
    await recordScore(env.DB, {
      clerkUserId: 'player_4',
      mode: 'daily',
      day: '2026-09-01',
      score: 10,
      now: Date.now(),
    })
    await recordScore(env.DB, {
      clerkUserId: 'player_4',
      mode: 'daily',
      day: '2026-09-02',
      score: 20,
      now: Date.now(),
    })

    const rows = await env.DB.prepare(
      'SELECT day, score FROM scores WHERE clerk_user_id = ? ORDER BY day',
    )
      .bind('player_4')
      .all()
    expect(rows.results).toHaveLength(2)
  })

  it('leaderboard results across modes never mix -- a rush score never appears on the boss board', async () => {
    await insertUser(env.DB, { clerk_user_id: 'player_5', created_at: Date.now() })
    await recordScore(env.DB, {
      clerkUserId: 'player_5',
      mode: 'rush',
      day: '2026-09-01',
      score: 999,
      now: Date.now(),
    })

    const bossBoard = await getAllTimeLeaderboard(env.DB, 'boss')
    expect(bossBoard.find((row) => row.clerk_user_id === 'player_5')).toBeUndefined()
  })
})
