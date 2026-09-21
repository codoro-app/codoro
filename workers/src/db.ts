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

/**
 * T7's finding: the plan's PUT /api/profile description assumes "row
 * creation for users: already handled by T3's lazy-insert-on-first-
 * authenticated-write" -- checked directly against this file and
 * `src/index.ts`, no such call exists anywhere outside tests (every
 * `insertUser` call site is a test fixture seeding its own row). Nothing
 * before T7 needed a `users` row to exist for an authenticated write to
 * succeed -- DELETE /api/account tolerates a missing row by design
 * (idempotent), and no other authenticated write route exists yet. T7 is
 * the first one that does (profiles.clerk_user_id REFERENCES
 * users.clerk_user_id), so this is where the lazy-insert this file's own
 * doc comment already assumed gets built, once, for every future
 * authenticated write route to reuse.
 *
 * `INSERT ... ON CONFLICT DO NOTHING` rather than get-then-insert: a
 * single statement, race-safe under concurrent first-writes the same way
 * `recordScore`'s upsert already is, no separate existence check needed.
 */
export async function getOrCreateUser(db: D1Database, clerkUserId: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO users (clerk_user_id, created_at) VALUES (?, ?) ON CONFLICT (clerk_user_id) DO NOTHING',
    )
    .bind(clerkUserId, Date.now())
    .run()
}

/**
 * T7: first-write-wins for the v2 `anonId` link. The `WHERE ... IS NULL`
 * guard is what makes "written only once" true regardless of how many
 * times a client (mistakenly or not) sends a later, different value --
 * there is no application-level branch to get this wrong, same style as
 * `recordScore`'s keep-best WHERE clause.
 */
export async function linkAnonIdIfUnset(
  db: D1Database,
  clerkUserId: string,
  anonId: string,
): Promise<void> {
  await db
    .prepare(
      'UPDATE users SET linked_anon_id = ? WHERE clerk_user_id = ? AND linked_anon_id IS NULL',
    )
    .bind(anonId, clerkUserId)
    .run()
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

// v6 Phase 6.2a: entitlements + the webhook idempotency ledger (migration
// 0003). §1 of the payments spec ("events are triggers, not truth") is why
// `upsertEntitlement` is the *only* write here -- it's called from exactly
// one place, stripe.ts's authoritative-read helper, which derives every
// field from a freshly-retrieved Stripe Subscription object, never from a
// webhook event's own JSON body.

export type Tier = 'free' | 'coach'

export interface EntitlementRow {
  clerk_user_id: string
  tier: Tier
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_status: string | null
  current_period_end: number | null
  cancel_at_period_end: 0 | 1
  updated_at: number
}

export interface UpsertEntitlementInput {
  clerkUserId: string
  tier: Tier
  stripeCustomerId: string
  stripeSubscriptionId: string
  stripeStatus: string
  /** Unix seconds, from `subscription.items.data[0].current_period_end` -- see stripe.ts's own comment on why not the subscription root (Piece 0 finding). */
  currentPeriodEnd: number | null
  cancelAtPeriodEnd: boolean
  now: number
}

/**
 * Upsert-by-clerk_user_id, same shape as profileStore.ts's `put` (blind
 * replace, not optimistic-concurrency -- there's no client-supplied
 * revision to race against here, only Stripe's own event ordering, which
 * §1's re-read-on-every-event design already makes safe to apply
 * out-of-order: whichever event arrives last just triggers one more
 * authoritative read that overwrites with the (still-correct) current
 * state).
 */
export async function upsertEntitlement(
  db: D1Database,
  input: UpsertEntitlementInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO entitlements (clerk_user_id, tier, stripe_customer_id, stripe_subscription_id, stripe_status, current_period_end, cancel_at_period_end, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (clerk_user_id) DO UPDATE SET
         tier = excluded.tier,
         stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         stripe_status = excluded.stripe_status,
         current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.clerkUserId,
      input.tier,
      input.stripeCustomerId,
      input.stripeSubscriptionId,
      input.stripeStatus,
      input.currentPeriodEnd,
      input.cancelAtPeriodEnd ? 1 : 0,
      input.now,
    )
    .run()
}

export async function getEntitlement(
  db: D1Database,
  clerkUserId: string,
): Promise<EntitlementRow | null> {
  return db
    .prepare('SELECT * FROM entitlements WHERE clerk_user_id = ?')
    .bind(clerkUserId)
    .first<EntitlementRow>()
}

/**
 * §3's fallback lookup: "store `stripe_customer_id` on the entitlements row
 * on first write, so a customer-scoped event can be resolved by lookup even
 * if metadata is somehow absent." Only reachable for a customer this Worker
 * has already written a row for at least once (i.e. resolves a *later*
 * event missing metadata, not a first-ever one -- nothing to look up before
 * any row exists).
 */
export async function getEntitlementByCustomerId(
  db: D1Database,
  stripeCustomerId: string,
): Promise<EntitlementRow | null> {
  return db
    .prepare('SELECT * FROM entitlements WHERE stripe_customer_id = ?')
    .bind(stripeCustomerId)
    .first<EntitlementRow>()
}

/**
 * F42: the idempotency ledger insert, called BEFORE any work in the webhook
 * handler (stripeWebhook.ts) -- not after. Returns `false` (not an error)
 * when `event_id` already exists, the UNIQUE-violation-as-"already
 * processed" contract §6 point 3 calls for. Any other failure rethrows.
 */
export async function tryRecordStripeEvent(
  db: D1Database,
  eventId: string,
  type: string,
  now: number,
): Promise<boolean> {
  try {
    await db
      .prepare('INSERT INTO stripe_events (event_id, type, processed_at) VALUES (?, ?, ?)')
      .bind(eventId, type, now)
      .run()
    return true
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return false
    }
    throw error
  }
}
