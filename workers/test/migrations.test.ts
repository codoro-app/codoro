import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { applyMigrationsUpTo } from './support/migrations'

// Isolated migration tests, the client's MIGRATIONS convention verbatim:
// seed the pre-state, apply, assert the post-state -- chain-only coverage
// (apply everything once, check the final schema) is explicitly not
// acceptance (T2 DoD). Each `it()` gets fresh, isolated D1 storage, so
// every test controls exactly how far the schema has progressed via
// applyMigrationsUpTo() rather than relying on file-level ordering.

describe('migration 0001 -- initial schema', () => {
  it('creates a user row that can be inserted and read back', async () => {
    await applyMigrationsUpTo(1)
    const now = Date.now()
    await env.DB.prepare('INSERT INTO users (clerk_user_id, created_at) VALUES (?, ?)')
      .bind('user_1', now)
      .run()
    const row = await env.DB.prepare('SELECT * FROM users WHERE clerk_user_id = ?')
      .bind('user_1')
      .first()
    expect(row).toMatchObject({ clerk_user_id: 'user_1', public_profile: 0, created_at: now })
  })

  it('rejects a scores row referencing a clerk_user_id with no matching users row (FK enforced, not assumed)', async () => {
    await applyMigrationsUpTo(1)
    await expect(
      env.DB.prepare(
        'INSERT INTO scores (clerk_user_id, mode, day, score, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind('ghost', 'daily', '2026-09-10', 100, Date.now())
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/i)
  })

  it('rejects a scores_best row referencing a clerk_user_id with no matching users row', async () => {
    await applyMigrationsUpTo(1)
    await expect(
      env.DB.prepare(
        'INSERT INTO scores_best (clerk_user_id, mode, score, achieved_day, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind('ghost', 'daily', 100, '2026-09-10', Date.now())
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/i)
  })

  it('rejects an out-of-enum mode on scores via the CHECK constraint', async () => {
    await applyMigrationsUpTo(1)
    await env.DB.prepare('INSERT INTO users (clerk_user_id, created_at) VALUES (?, ?)')
      .bind('user_2', Date.now())
      .run()
    await expect(
      env.DB.prepare(
        'INSERT INTO scores (clerk_user_id, mode, day, score, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind('user_2', 'not-a-mode', '2026-09-10', 100, Date.now())
        .run(),
    ).rejects.toThrow(/CHECK/i)
  })

  it('rejects an out-of-enum reason on reports via the CHECK constraint', async () => {
    await applyMigrationsUpTo(1)
    await expect(
      env.DB.prepare(
        'INSERT INTO reports (id, puzzle_id, reason, app_version, created_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind('rep_1', 'tc-009', 'not-a-reason', '1.0.0', Date.now())
        .run(),
    ).rejects.toThrow(/CHECK/i)
  })

  it('accepts every reason in the fixed enum on reports (unauthenticated, no clerk_user_id column)', async () => {
    await applyMigrationsUpTo(1)
    const reasons = ['wrong-answer', 'unclear', 'renders-broken', 'typo', 'other']
    for (const [i, reason] of reasons.entries()) {
      await env.DB.prepare(
        'INSERT INTO reports (id, puzzle_id, reason, app_version, created_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(`rep_${String(i)}`, 'tc-009', reason, '1.0.0', Date.now())
        .run()
    }
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports').first<{ n: number }>()
    expect(count?.n).toBe(reasons.length)
  })

  it('cascade-deletes profiles, scores, scores_best, and email_prefs when the owning user is deleted -- verified, not assumed (F7)', async () => {
    await applyMigrationsUpTo(1)
    const now = Date.now()
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (clerk_user_id, created_at) VALUES (?, ?)').bind(
        'user_3',
        now,
      ),
      env.DB.prepare(
        `INSERT INTO profiles (clerk_user_id, revision, schema_version, payload, payload_bytes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind('user_3', 1, 1, new Uint8Array([1, 2, 3]).buffer, 3, now),
      env.DB.prepare(
        'INSERT INTO scores (clerk_user_id, mode, day, score, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).bind('user_3', 'daily', '2026-09-10', 500, now),
      env.DB.prepare(
        'INSERT INTO scores_best (clerk_user_id, mode, score, achieved_day, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).bind('user_3', 'daily', 500, '2026-09-10', now),
      env.DB.prepare('INSERT INTO email_prefs (clerk_user_id) VALUES (?)').bind('user_3'),
    ])

    // Sanity: the seed actually landed before the cascade is exercised --
    // otherwise a no-op DELETE would pass this test for the wrong reason.
    const seeded = await env.DB.prepare('SELECT 1 FROM profiles WHERE clerk_user_id = ?')
      .bind('user_3')
      .first()
    expect(seeded).not.toBeNull()

    await env.DB.prepare('DELETE FROM users WHERE clerk_user_id = ?').bind('user_3').run()

    const [profile, score, best, prefs] = await Promise.all([
      env.DB.prepare('SELECT 1 FROM profiles WHERE clerk_user_id = ?').bind('user_3').first(),
      env.DB.prepare('SELECT 1 FROM scores WHERE clerk_user_id = ?').bind('user_3').first(),
      env.DB.prepare('SELECT 1 FROM scores_best WHERE clerk_user_id = ?').bind('user_3').first(),
      env.DB.prepare('SELECT 1 FROM email_prefs WHERE clerk_user_id = ?').bind('user_3').first(),
    ])
    expect(profile).toBeNull()
    expect(score).toBeNull()
    expect(best).toBeNull()
    expect(prefs).toBeNull()
  })

  it('does not yet have migration 0002 index (schema before 0002 applies)', async () => {
    await applyMigrationsUpTo(1)
    const idx = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_scores_best_updated_at'",
    ).first()
    expect(idx).toBeNull()
  })
})

describe('migration 0002 -- additive index, dry-runs the migration-application machinery end-to-end', () => {
  it('preserves data seeded under 0001 and adds the new index (real seed-apply-assert, not chain-only coverage)', async () => {
    await applyMigrationsUpTo(1)
    const now = Date.now()
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (clerk_user_id, created_at) VALUES (?, ?)').bind(
        'user_4',
        now,
      ),
      env.DB.prepare(
        'INSERT INTO scores_best (clerk_user_id, mode, score, achieved_day, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).bind('user_4', 'rush', 42, '2026-09-10', now),
    ])

    await applyMigrationsUpTo(2)

    const row = await env.DB.prepare('SELECT score FROM scores_best WHERE clerk_user_id = ?')
      .bind('user_4')
      .first<{ score: number }>()
    expect(row?.score).toBe(42)

    const idx = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_scores_best_updated_at'",
    ).first()
    expect(idx).not.toBeNull()
  })
})
