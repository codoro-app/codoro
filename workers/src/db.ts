/**
 * Typed D1 query helpers -- no ORM. Row shapes mirror
 * migrations/0001_init.sql column-for-column; workers/README.md documents
 * the "why" per column, this file is the "how" per query.
 *
 * S2: the `profiles` table's compressed blob column is owned entirely by
 * profileStore.ts -- nothing here selects or writes it
 * (workers/test/static/profileStorePayloadGuard.test.ts enforces this by
 * grepping for that column's literal name outside that one file).
 *
 * Scoped to what T2's tests actually exercise, same discipline as
 * shared/api-types.ts: a helper with no caller yet is dead code, not
 * documentation. T3/T4a/T7/T9/T10/T12 extend this file as their endpoints
 * need to -- `email_prefs` and `reports` have no helpers here yet because
 * nothing calls them until T4a/T12.
 */

export interface UserRow {
  clerk_user_id: string
  username: string | null
  username_changed_at: number | null
  public_profile: 0 | 1
  linked_anon_id: string | null
  created_at: number
}

export type NewUserRow = Pick<UserRow, 'clerk_user_id' | 'created_at'>

export async function insertUser(db: D1Database, row: NewUserRow): Promise<void> {
  await db
    .prepare('INSERT INTO users (clerk_user_id, created_at) VALUES (?, ?)')
    .bind(row.clerk_user_id, row.created_at)
    .run()
}

export async function getUser(db: D1Database, clerkUserId: string): Promise<UserRow | null> {
  return db
    .prepare('SELECT * FROM users WHERE clerk_user_id = ?')
    .bind(clerkUserId)
    .first<UserRow>()
}

export async function deleteUser(db: D1Database, clerkUserId: string): Promise<void> {
  await db.prepare('DELETE FROM users WHERE clerk_user_id = ?').bind(clerkUserId).run()
}

export type ScoreMode = 'daily' | 'rush' | 'boss'

export interface RecordScoreInput {
  clerkUserId: string
  mode: ScoreMode
  day: string
  score: number
  runMeta?: string | null
  now: number
}

/**
 * S3's upsert-keep-best write, one D1 batch() touching both tables:
 * `scores` keeps the best score per user/mode/DAY (the 90-day window);
 * `scores_best` keeps the best score per user/mode across ALL days (never
 * pruned). This is the concrete mechanism workers/test/scoresBest.test.ts
 * proves is duplicate-free per mode on the all-time board -- the
 * correctness fix S3 exists for, not just an optimization.
 *
 * "Keep-best" is enforced by the UPSERT's own WHERE clause (SQLite
 * upsert-with-condition), not by reading-then-comparing in application
 * code: a conflicting row is only updated when the new score is strictly
 * greater, so a replayed write from T8's retry queue (F12) can never
 * regress a stored best.
 */
export async function recordScore(db: D1Database, input: RecordScoreInput): Promise<void> {
  const { clerkUserId, mode, day, score, runMeta = null, now } = input
  await db.batch([
    db
      .prepare(
        `INSERT INTO scores (clerk_user_id, mode, day, score, run_meta, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (clerk_user_id, mode, day) DO UPDATE SET
           score = excluded.score, run_meta = excluded.run_meta, updated_at = excluded.updated_at
         WHERE excluded.score > scores.score`,
      )
      .bind(clerkUserId, mode, day, score, runMeta, now),
    db
      .prepare(
        `INSERT INTO scores_best (clerk_user_id, mode, score, achieved_day, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (clerk_user_id, mode) DO UPDATE SET
           score = excluded.score, achieved_day = excluded.achieved_day, updated_at = excluded.updated_at
         WHERE excluded.score > scores_best.score`,
      )
      .bind(clerkUserId, mode, score, day, now),
  ])
}

export interface ScoreBestRow {
  clerk_user_id: string
  mode: ScoreMode
  score: number
  achieved_day: string
  updated_at: number
}

/**
 * `GET /api/leaderboard?window=all`'s query shape (T10 wires the route;
 * this is the query it will call). Reads `scores_best` exclusively --
 * `scores` (the day-keyed rolling window) is what window=day reads instead.
 */
export async function getAllTimeLeaderboard(
  db: D1Database,
  mode: ScoreMode,
  limit = 50,
): Promise<ScoreBestRow[]> {
  const result = await db
    .prepare('SELECT * FROM scores_best WHERE mode = ? ORDER BY score DESC LIMIT ?')
    .bind(mode, limit)
    .all<ScoreBestRow>()
  return result.results
}

export interface NewReportRow {
  puzzleId: string
  reason: string
  appVersion: string
  now: number
}

/**
 * T4a: `POST /api/report`'s only write. `id` is server-generated here
 * (`crypto.randomUUID()`, Web Crypto -- available in workerd with no
 * import, same API a browser has), never client-supplied -- there is no
 * `clerk_user_id`/IP column to omit-by-construction (migration 0001's
 * comment on this table), and `reason`'s enum is enforced twice over
 * (report.ts's Zod schema before this is ever called, and the table's own
 * `CHECK` constraint here) -- this function trusts its caller to have
 * already validated `reason` and `puzzleId`, it does not re-validate them.
 */
export async function insertReport(db: D1Database, input: NewReportRow): Promise<void> {
  await db
    .prepare(
      'INSERT INTO reports (id, puzzle_id, reason, app_version, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(crypto.randomUUID(), input.puzzleId, input.reason, input.appVersion, input.now)
    .run()
}
