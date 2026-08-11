# Boss Challenges (v3 Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Boss mode — a fixed 10-puzzle, hand-authored, escalating-difficulty run with a 3-strikes end condition — as codoro's fourth own-mode, following Rush's session-hook + page + route structure.

**Architecture:** A single hardcoded ordered puzzle-id array (`BOSS_RUN`, no live selection algorithm — the run is fully authored, so "deterministic" needs no RNG at all) resolved against the existing `quizPool`. A new `useBossSession` hook orchestrates a much simpler loop than Rush's (no per-puzzle clock, no difficulty widening): serve `BOSS_RUN[i]`, track strikes, end on the 3rd strike or on completing puzzle 10. Best-ever depth persists in a new `bossStats` profile field (schema v6→v7), never rated (mirrors Rush's `shouldRateAttempt` isolation). New `/boss` route registered everywhere Rush/Settings are (routes.ts, App.tsx, `_redirects`, SW denylist, NavRail, ModeSwitcher).

**Tech Stack:** React (session hook + page component), Zod (schema/migration), Vitest + Testing Library (tests), existing `content`/`storage`/`telemetry`/`engine` barrels.

## Global Constraints

- `pnpm validate` (typecheck + lint + test + validate:content + build) must stay green after every task.
- No fix/behavior without a stated reason; every schema change gets an isolated migration test (not chain-only coverage); `export`/`import` round-trips every new field.
- Boss is unrated by construction: `shouldRateAttempt('boss', _)` is hardcoded `false`, mirroring Rush exactly — guarded by an orchestration-level test, not just the pure-function unit test.
- Boss excludes `scrubber` puzzles (binary strike/correct model doesn't fit scrubber's per-checkpoint partial credit) — same rule `DAILY_CALENDAR` already enforces for the identical reason.
- Every design decision below is already locked (`docs/v3-build-plan.md` Phase 1, "Design questions — settled, 2026-08-10", plus this plan's own run-assembly decision, direct user decision 2026-08-10): curated fixed set, best-score-only, 3-strikes end condition, boss completion as the future mission trigger surface, **exactly one authored `BOSS_RUN` for this phase** (no multi-set selection engine — flagged below as known near-term follow-up, not built now).
- Real puzzle ids used in `BOSS_RUN` below were pulled directly from the actual `src/content/puzzles/**` pool (verified against every puzzle's real `difficulty_rating`/`interaction` — not fabricated).

---

## Design record (write this down before Task 1 touches code)

**Run-assembly decision — direct user decision, 2026-08-10.** The build plan's Phase 1 build item 2 calls for run assembly that is "deterministic and seeded, tested against the real pool." Chose: **a single hand-authored `BOSS_RUN` array for this phase** — the plan's "curated fixed sets" design decision doesn't specify a set _count_, and a static, exactly-once-authored order needs no RNG or seed at all (there's nothing to select between yet); "deterministic" is inherently satisfied by construction. Every replay of Boss currently plays the identical 10 puzzles in the identical order — consistent with best-score-only (replaying to beat your own depth is the loop, not variety).

**Flagged explicitly, not silently punted: Boss will need more than one curated set soon.** A single fixed sequence's novelty runs out fast for a repeat player — this is a known, accepted gap of this phase's scope, not an oversight. The natural next step (a `BOSS_SETS` registry + a selection function — rotate by runs completed, or a calendar index mirroring `DAILY_CALENDAR`) is real, additive follow-up work, deliberately deferred out of this phase to keep it buildable in ~2 sessions. `bossRun.ts`'s own doc comment (Task 3) restates this so the next person to touch the file sees it without needing this plan.

**Scope note — no BossShareCard/BossChallengeCard this phase.** Phase 1's build item list (`docs/v3-build-plan.md`) asks only for "Payoff surface: end-of-run summary with the escalation arc visible" — it does not ask for share/challenge cards the way Rush/Daily/Practice have them. This plan builds exactly that (an end-of-run summary, Task 8) and deliberately does not add share/challenge affordances, to stay inside the stated build items rather than gold-plating. Worth a fast follow if Thomas wants parity with the other modes, but not built here.

**Boss has no per-puzzle clock.** Unlike Rush, Phase 1's settled decisions never mention a Boss timer — only the 3-strikes end condition. `useBossSession` (Task 7) is deliberately untimed: no `RUSH_PUZZLE_TIME_LIMIT_MS` equivalent, no interval/visibilitychange machinery. This is simpler than Rush by design, not an oversight.

**"Depth reached" is the score.** The plan's own framing — "the payoff is the escalating-difficulty arc itself (how deep a run got)" — is modeled as `depthReached`: the 1-indexed position of the last puzzle the run reached (whether that puzzle was answered right or wrong), capped at 10. `cleared` (boolean) is `depthReached >= BOSS_RUN.length` — true whenever the run reaches puzzle 10, independent of whether the 3rd strike happened to land on that same puzzle. If a run's 3rd strike lands exactly on puzzle 10, `cleared` is still `true` (the run did reach the end of the sequence) but `ended_reason` in telemetry still reports `'strikes'` (that's literally what ended it) — both facts are real and both are recorded; neither is dropped for the other.

---

## Task 1: Storage — `bossStats`, schema v6→v7, migration, export/import round-trip

**Files:**

- Modify: `src/storage/schema.ts`
- Modify: `src/storage/migrations.ts`
- Modify: `src/storage/migrations.test.ts`
- Modify: `src/storage/exportImport.test.ts:24-25` and `:247-248`
- Modify: `src/storage/index.ts`

**Interfaces:**

- Produces: `BossStats` interface `{ bestDepth: number; clears: number; runs: number; lastRunAt: string | null }`, `BossStatsSchema` (Zod), `UserProfile.bossStats: BossStats | null`, `CURRENT_SCHEMA_VERSION = 7`.

- [ ] **Step 1: Write the failing migration test**

Add to `src/storage/migrations.test.ts`, after the existing `MIGRATIONS[4]` describe block:

```ts
describe('MIGRATIONS[6]: v6 -> v7 (v3 Phase 1: adds bossStats)', () => {
  it('stamps schema_version 7, adds bossStats: null, and preserves every other field untouched', () => {
    const v6Profile = {
      schema_version: 6,
      rating: 1450.75,
      ratedAttemptCount: 18,
      streak: { currentStreak: 5, longestStreak: 12, lastActiveDate: '2026-08-05' },
      requeueState: [{ puzzleId: 'p4', stage: 2, served: 1 }],
      storagePersisted: true,
      dailyCompletion: { date: '2026-08-05', attemptId: 'a11', correct: true },
      rushStats: { bestScore: 15, bestStreak: 9, runs: 4, lastRunAt: '2026-08-04T12:00:00.000Z' },
      bestRunStreak: 22,
      anonId: 'anon-abc-123',
    }

    const v6Migration = MIGRATIONS[6]
    if (!v6Migration) throw new Error('MIGRATIONS[6] is not registered')
    const migrated = v6Migration(v6Profile)

    expect(migrated).toEqual({
      ...v6Profile,
      schema_version: 7,
      bossStats: null,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test migrations.test.ts`
Expected: FAIL — `MIGRATIONS[6] is not registered`

- [ ] **Step 3: Implement — schema.ts, migrations.ts, exportImport.test.ts, index.ts**

In `src/storage/schema.ts`, bump the version:

```ts
export const CURRENT_SCHEMA_VERSION = 7
```

Add after `RushStatsSchema`/`RushStats`:

```ts
/**
 * Boss's persisted best-ever stats (v3 Phase 1) — mirrors RushStatsSchema's
 * shape and null-until-first-run convention. `bestDepth` is the deepest any
 * run has ever reached (1-10, see useBossSession's own doc comment for the
 * "depth reached" definition); `clears` counts full completions (depth
 * reached === BOSS_RUN.length) separately from `runs` (every run, cleared or
 * struck out) because a future mission-progression trigger (Phase 2) needs
 * "has this player ever cleared a boss run" as a queryable fact without
 * re-deriving it from raw attempt history.
 */
export const BossStatsSchema = z.object({
  bestDepth: z.number().int().nonnegative(),
  clears: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
  lastRunAt: z.string().nullable(),
})

export interface BossStats {
  bestDepth: number
  clears: number
  runs: number
  lastRunAt: string | null
}
```

Add the field to `UserProfileSchema` and `UserProfile` (after `bestRunStreak`, before `anonId`, matching migration-add order):

```ts
  bestRunStreak: z.number().int().nonnegative(),
  /** Non-null once at least one Boss run has completed — see BossStatsSchema's doc comment. */
  bossStats: BossStatsSchema.nullable(),
  anonId: z.string().min(1),
```

and the matching `UserProfile` interface line:

```ts
/** Non-null once at least one Boss run has completed — see BossStats's doc comment. */
bossStats: BossStats | null
```

Update `createDefaultProfile()`:

```ts
    bestRunStreak: 0,
    bossStats: null,
    anonId: generateAnonId(),
```

In `src/storage/migrations.ts`, add the migration and register it:

```ts
/**
 * v6 -> v7: v3 Phase 1's Boss mode adds `bossStats` (nullable), same
 * null-until-first-run convention as `rushStats` — see
 * src/storage/schema.ts's BossStatsSchema doc comment. Every existing field
 * is passed through unchanged.
 */
function migrateV6ToV7(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, schema_version: 7, bossStats: null }
}
```

```ts
export const MIGRATIONS: Record<number, Migration> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
  3: migrateV3ToV4,
  4: migrateV4ToV5,
  5: migrateV5ToV6,
  6: migrateV6ToV7,
}
```

In `src/storage/exportImport.test.ts`, add `bossStats: null` next to both existing `rushStats: null` occurrences (lines ~24-25 and ~247-248) — these are hand-built fixture profile objects that will otherwise fail Zod validation once `bossStats` is a required (nullable-but-present) field.

In `src/storage/index.ts`, export the new type:

```ts
export type { UserProfile, Attempt, RushStats, BossStats } from './schema'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test migrations.test.ts exportImport.test.ts schema.test.ts`
Expected: PASS — all green, including any other existing hardcoded `UserProfile` fixtures if `tsc`/Zod surfaces one missing `bossStats`.

- [ ] **Step 5: Commit**

```bash
git add src/storage/schema.ts src/storage/migrations.ts src/storage/migrations.test.ts src/storage/exportImport.test.ts src/storage/index.ts
git commit -m "v3 Phase 1: add bossStats to profile schema (v6->v7 migration)"
```

---

## Task 2: Engine — `AttemptMode` gains `'boss'`, `BOSS_STRIKE_LIMIT`

**Files:**

- Modify: `src/engine/rating.ts`
- Modify: `src/engine/rating.test.ts`
- Modify: `src/storage/schema.ts` (AttemptSchema's `mode` enum)
- Create: `src/engine/boss.ts`
- Create: `src/engine/boss.test.ts`
- Modify: `src/engine/index.ts`

**Interfaces:**

- Produces: `AttemptMode = 'practice' | 'daily' | 'rush' | 'boss'`, `shouldRateAttempt('boss', _) => false`, `BOSS_STRIKE_LIMIT: number` (exported from `engine/boss.ts`, re-exported via `engine/index.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/rating.test.ts`, inside the existing `describe('shouldRateAttempt', ...)` block:

```ts
it('never rates boss attempts', () => {
  expect(shouldRateAttempt('boss', true)).toBe(false)
  expect(shouldRateAttempt('boss', false)).toBe(false)
})
```

Create `src/engine/boss.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BOSS_STRIKE_LIMIT } from './boss'

describe('BOSS_STRIKE_LIMIT', () => {
  it('is 3, matching the settled design decision (docs/v3-build-plan.md Phase 1)', () => {
    expect(BOSS_STRIKE_LIMIT).toBe(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test rating.test.ts boss.test.ts`
Expected: FAIL — `shouldRateAttempt('boss', ...)` doesn't typecheck against the current `AttemptMode` union, and `boss.test.ts` fails to resolve `./boss` (file doesn't exist yet).

- [ ] **Step 3: Implement**

In `src/engine/rating.ts`:

```ts
export type AttemptMode = 'practice' | 'daily' | 'rush' | 'boss'
```

```ts
export function shouldRateAttempt(mode: AttemptMode, isFirstAttemptOfDay: boolean): boolean {
  switch (mode) {
    case 'practice':
      return true
    case 'daily':
      return isFirstAttemptOfDay
    case 'rush':
      return false
    case 'boss':
      return false
  }
}
```

In `src/storage/schema.ts`, widen `AttemptSchema`'s locked mode enum:

```ts
  // Literal values must stay in sync with engine's AttemptMode union.
  mode: z.enum(['practice', 'daily', 'rush', 'boss']),
```

Create `src/engine/boss.ts`:

```ts
/**
 * Boss-mode domain constants. No selection logic lives here (unlike
 * rush.ts) — Boss's run order is a fixed, hand-authored sequence
 * (src/content/bossRun.ts), not a live draw from a pool, so there is
 * nothing to select or weight. This file exists purely to give Boss's one
 * real domain constant the same home Rush's own constants have (RUSH_
 * STRIKE_LIMIT lives in rush.ts, not in the session hook), so a future
 * consumer (e.g. Phase 2's mission-progression trigger) can import it
 * without reaching into useBossSession.ts's private module scope.
 */

/**
 * Wrong answers (a Boss puzzle has no clock, unlike Rush — see this plan's
 * design record — so every strike here is a real wrong answer, never a
 * timeout) that end a Boss run. Direct user decision, docs/v3-build-plan.md
 * Phase 1 design question 3: "more forgiving — the payoff is the
 * escalating-difficulty arc itself... a single early misclick ending a
 * 10-puzzle run would undercut that framing." Deliberately its own constant,
 * not a re-export of rush.ts's RUSH_STRIKE_LIMIT: the two happen to share a
 * value today, but they are independent design decisions for independent
 * modes, and coupling them would make a future change to one silently
 * change the other.
 */
export const BOSS_STRIKE_LIMIT = 3
```

In `src/engine/index.ts`, add the barrel export (after the Rush block):

```ts
export { BOSS_STRIKE_LIMIT } from './boss'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test rating.test.ts boss.test.ts schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/rating.ts src/engine/rating.test.ts src/engine/boss.ts src/engine/boss.test.ts src/engine/index.ts src/storage/schema.ts
git commit -m "v3 Phase 1: add 'boss' AttemptMode and BOSS_STRIKE_LIMIT"
```

---

## Task 3: Content — `BOSS_RUN`, validator, real-pool test

**Files:**

- Create: `src/content/bossRun.ts`
- Create: `src/content/bossRun.test.ts`
- Modify: `src/content/tools/validatePuzzles.ts`
- Modify: `src/content/tools/validatePuzzles.test.ts`
- Modify: `src/content/tools/validateContent.ts`
- Modify: `src/content/index.ts`

**Interfaces:**

- Produces: `BOSS_RUN: readonly string[]` (10 real puzzle ids, escalating rating), `BOSS_RUN_LENGTH = 10`, `validateBossRun(bossRun, valid): string[]`.

- [ ] **Step 1: Write the failing tests**

Create `src/content/bossRun.test.ts` (real-pool test — mirrors `src/content/index.test.ts`'s "against the real puzzlePool, not a fixture" convention):

```ts
import { describe, expect, it } from 'vitest'
import { quizPool } from './index'
import { BOSS_RUN } from './bossRun'

describe('BOSS_RUN — against the real content pool', () => {
  it('resolves every id to a real, non-scrubber puzzle', () => {
    const ids = new Set(quizPool.map((puzzle) => puzzle.id))
    for (const id of BOSS_RUN) {
      expect(ids.has(id), `"${id}" not found in quizPool`).toBe(true)
    }
  })

  it('has exactly 10 unique entries', () => {
    expect(BOSS_RUN).toHaveLength(10)
    expect(new Set(BOSS_RUN).size).toBe(10)
  })

  it("escalates: each entry's difficulty_rating is >= the previous entry's", () => {
    const byId = new Map(quizPool.map((puzzle) => [puzzle.id, puzzle]))
    const ratings = BOSS_RUN.map((id) => {
      const puzzle = byId.get(id)
      if (!puzzle) throw new Error(`"${id}" not found in quizPool`)
      return puzzle.difficulty_rating
    })
    for (let i = 1; i < ratings.length; i++) {
      expect(ratings[i]).toBeGreaterThanOrEqual(ratings[i - 1])
    }
  })
})
```

Add to `src/content/tools/validatePuzzles.test.ts`, after the existing `describe('validateDailyCalendar', ...)` block (reuses that block's `validated()` helper — check its exact signature first; extend it to accept an optional `difficulty_rating` parameter rather than duplicating a new helper, e.g. `function validated(id: string, interaction: string, difficulty_rating = 1000): ValidatedPuzzle`):

```ts
import { validateBossRun } from './validatePuzzles'

describe('validateBossRun', () => {
  const boss1 = validated('boss-001', 'mcq', 1000)
  const boss2 = validated('boss-002', 'mcq', 1100)
  const boss3 = validated('boss-003', 'mcq', 1050)
  const tenAscending = Array.from({ length: 10 }, (_, i) => `boss-${String(i).padStart(3, '0')}`)
  const tenAscendingValid = tenAscending.map((id, i) => validated(id, 'mcq', 1000 + i * 50))

  it('passes exactly 10 unique, non-scrubber, escalating ids', () => {
    const errors = validateBossRun(tenAscending, tenAscendingValid)
    expect(errors).toEqual([])
  })

  it('flags a run that is not exactly 10 entries long', () => {
    const errors = validateBossRun(['boss-001', 'boss-002'], [boss1, boss2])
    expect(errors.some((e) => e.includes('expected exactly 10 entries'))).toBe(true)
  })

  it('flags a duplicate id, naming its position', () => {
    const tenWithDup = [...tenAscending.slice(0, 9), tenAscending[0] as string]
    const errors = validateBossRun(tenWithDup, tenAscendingValid)
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true)
  })

  it('flags an entry that does not match any valid puzzle', () => {
    const tenWithMissing = [...tenAscending.slice(0, 9), 'missing-id']
    const errors = validateBossRun(tenWithMissing, tenAscendingValid)
    expect(errors.some((e) => e.includes('missing-id') && e.includes('does not match'))).toBe(true)
  })

  it('rejects a scrubber puzzle id (Boss needs a binary strike outcome)', () => {
    const errors = validateBossRun(
      ['boss-001', 'scr-001'],
      [boss1, validated('scr-001', 'scrubber', 1000)],
    )
    expect(errors.some((e) => e.includes('scrubber puzzle'))).toBe(true)
  })

  it('flags a rating that steps down instead of escalating', () => {
    const errors = validateBossRun(['boss-001', 'boss-002', 'boss-003'], [boss1, boss2, boss3])
    expect(errors.some((e) => e.includes('must escalate'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test bossRun.test.ts validatePuzzles.test.ts`
Expected: FAIL — `./bossRun` doesn't resolve, `validateBossRun` is not exported.

- [ ] **Step 3: Implement**

Create `src/content/bossRun.ts`:

```ts
/**
 * Boss run v1 — a single hand-authored, fixed-order sequence of 10 puzzle
 * ids, escalating difficulty. See docs/v3-build-plan.md Phase 1 "Design
 * questions — settled": curated fixed sets over rating-laddered draws,
 * chosen for pacing/narrative control over a run — a boss fight reads as
 * authored escalation, not a random sample that happens to trend harder.
 *
 * v1 SCOPE, NOT THE FINAL SHAPE: this file holds exactly one set because
 * that's all v3 Phase 1 needs to ship Boss at all — every run currently
 * plays the identical 10 puzzles in the identical order (best-score-only
 * makes that a feature, not a bug: replay to beat your own depth). This is a
 * known, deliberate gap, flagged here on purpose: Boss WILL need more than
 * one curated set soon after launch (a single fixed sequence's novelty runs
 * out fast for a repeat player). When that's built, replace this single
 * `BOSS_RUN` array with a `BOSS_SETS: readonly (readonly string[])[]`
 * registry plus a selection function (rotate by runs completed, or a
 * calendar index mirroring dailyCalendar.ts's `getDailyCalendarIndex`) —
 * both were considered and explicitly deferred out of this phase, not
 * silently punted. See the Boss Challenges implementation plan's own
 * "Design record" section for the full decision.
 *
 * Excludes scrubber puzzles: Boss's strike model needs a binary
 * correct/wrong outcome per puzzle, which scrubber's per-checkpoint partial
 * credit doesn't produce — same reasoning as DAILY_CALENDAR's own scrubber
 * exclusion (see validatePuzzles.ts's validateDailyCalendar doc comment).
 *
 * Every id below is validated against the real content pool by
 * validateBossRun (validatePuzzles.ts), wired into `pnpm validate:content`,
 * and against the real quizPool by bossRun.test.ts.
 */
export const BOSS_RUN: readonly string[] = [
  'oob-001', //  900 mcq          off-by-one
  'err-005', // 1075 swipe-binary error-handling
  'mut-003', // 1200 tap-line     mutable-state
  'inp-011', // 1275 drag-order   input-validation
  'dsm-021', // 1375 swipe-binary data-structure-misuse
  'con-006', // 1500 mcq          concurrency
  'rec-003', // 1600 tap-line     recursion-termination
  'dsm-007', // 1700 tap-line     data-structure-misuse
  'con-007', // 1800 mcq          concurrency
  'inp-004', // 2075 swipe-binary input-validation
]
```

In `src/content/tools/validatePuzzles.ts`, add near `validateDailyCalendar`:

```ts
/**
 * Boss's authored run (src/content/bossRun.ts) gets the same treatment as
 * the daily calendar above: every id must resolve to a real, non-scrubber
 * puzzle, and ids must be unique. Boss-specific on top of that, since the
 * whole feature's premise is "escalating difficulty": ratings must be
 * non-decreasing across the run, and the run must be exactly
 * BOSS_RUN_LENGTH long. A future hand-edit that breaks the escalation (or
 * silently drops/adds a puzzle) fails the build instead of shipping a Boss
 * run that doesn't actually escalate.
 */
export const BOSS_RUN_LENGTH = 10

export function validateBossRun(
  bossRun: readonly string[],
  valid: readonly ValidatedPuzzle[],
): string[] {
  const errors: string[] = []
  const byId = new Map(valid.map((entry) => [entry.puzzle.id, entry.puzzle]))
  const scrubberIds = new Set(
    valid
      .filter((entry) => entry.puzzle.interaction === 'scrubber')
      .map((entry) => entry.puzzle.id),
  )

  if (bossRun.length !== BOSS_RUN_LENGTH) {
    errors.push(
      `bossRun.ts: expected exactly ${String(BOSS_RUN_LENGTH)} entries, found ${String(bossRun.length)}`,
    )
  }

  const seen = new Set<string>()
  let previousRating: number | null = null

  bossRun.forEach((id, index) => {
    if (seen.has(id)) {
      errors.push(`bossRun.ts: duplicate id "${id}" at position ${String(index)}`)
      return
    }
    seen.add(id)

    if (scrubberIds.has(id)) {
      errors.push(
        `bossRun.ts: entry "${id}" at position ${String(index)} is a scrubber puzzle — Boss's strike model needs a binary correct/wrong outcome, not scrubber's partial credit.`,
      )
      return
    }

    const puzzle = byId.get(id)
    if (!puzzle) {
      errors.push(
        `bossRun.ts: entry "${id}" at position ${String(index)} does not match any valid puzzle`,
      )
      return
    }

    if (previousRating !== null && puzzle.difficulty_rating < previousRating) {
      errors.push(
        `bossRun.ts: entry "${id}" at position ${String(index)} (rating ${String(puzzle.difficulty_rating)}) is lower than the previous entry's rating ${String(previousRating)} — Boss must escalate, never step down`,
      )
    }
    previousRating = puzzle.difficulty_rating
  })

  return errors
}
```

In `src/content/tools/validateContent.ts`, wire it in:

```ts
import { BOSS_RUN } from '../bossRun'
```

```ts
import {
  validateBossRun,
  validateDailyCalendar,
  validateInteractionMix,
  validateLanguageMix,
  validatePuzzleFiles,
  validateRatingCluster,
} from './validatePuzzles'
```

```ts
const allErrors = [
  ...errors,
  ...validateDailyCalendar(DAILY_CALENDAR, valid),
  ...validateBossRun(BOSS_RUN, valid),
  ...validateRatingCluster(valid),
  ...validateLanguageMix(valid),
  ...validateInteractionMix(valid),
]
```

```ts
console.log(
  `validate:content: ${String(valid.length)} puzzle(s) OK, ${String(DAILY_CALENDAR.length)} daily-calendar entries OK, boss run OK`,
)
```

In `src/content/index.ts`, export it next to `DAILY_CALENDAR`:

```ts
export { DAILY_CALENDAR } from './dailyCalendar'
export { BOSS_RUN } from './bossRun'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test bossRun.test.ts validatePuzzles.test.ts && pnpm validate:content`
Expected: PASS, and `validate:content` prints `... boss run OK` with zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/content/bossRun.ts src/content/bossRun.test.ts src/content/tools/validatePuzzles.ts src/content/tools/validatePuzzles.test.ts src/content/tools/validateContent.ts src/content/index.ts
git commit -m "v3 Phase 1: author BOSS_RUN and wire validateBossRun into validate:content"
```

---

## Task 4: Telemetry — `trackBossAttempt`, `trackBossRunEnd`

**Files:**

- Modify: `src/telemetry/events.ts`
- Modify: `src/telemetry/telemetry.test.ts`
- Modify: `src/telemetry/index.ts`

**Interfaces:**

- Consumes: `AttemptEventPayload` (from Task 2's widened `AttemptMode`), `safeCapture` (existing).
- Produces: `BossAttemptContext { run_id: string; position_in_run: number }`, `trackBossAttempt(payload: AttemptEventPayload & BossAttemptContext): void`, `BossRunEndPayload { run_id: string; depth_reached: number; cleared: boolean; is_new_best_depth: boolean }`, `trackBossRunEnd(payload: BossRunEndPayload): void`.

- [ ] **Step 1: Write the failing tests**

Add to `src/telemetry/telemetry.test.ts`, after the existing `describe('trackRushRunEnd', ...)` block:

```ts
describe('trackBossAttempt', () => {
  it('captures the "attempt" event with the locked shape plus run-level context', async () => {
    const { trackBossAttempt } = await loadTelemetry('phc_test_key')
    const payload = {
      ...attemptPayload,
      mode: 'boss' as const,
      run_id: 'run-1',
      position_in_run: 4,
    }
    trackBossAttempt(payload)
    await flushPromises()
    expect(posthogMock.capture).toHaveBeenCalledWith('attempt', payload)
  })

  it('no-ops without calling posthog.capture when the key is unset', async () => {
    const { trackBossAttempt } = await loadTelemetry(undefined)
    trackBossAttempt({
      ...attemptPayload,
      mode: 'boss',
      run_id: 'run-1',
      position_in_run: 1,
    })
    await flushPromises()
    expect(posthogMock.capture).not.toHaveBeenCalled()
  })
})

describe('trackBossRunEnd', () => {
  it('captures boss_run_end with the exact payload shape', async () => {
    const { trackBossRunEnd } = await loadTelemetry('phc_test_key')
    const payload = {
      run_id: 'run-1',
      depth_reached: 7,
      cleared: false,
      is_new_best_depth: true,
    }
    trackBossRunEnd(payload)
    await flushPromises()
    expect(posthogMock.capture).toHaveBeenCalledWith('boss_run_end', payload)
  })

  it('no-ops without calling posthog.capture when the key is unset', async () => {
    const { trackBossRunEnd } = await loadTelemetry(undefined)
    trackBossRunEnd({ run_id: 'run-1', depth_reached: 0, cleared: false, is_new_best_depth: false })
    await flushPromises()
    expect(posthogMock.capture).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test telemetry.test.ts`
Expected: FAIL — `trackBossAttempt`/`trackBossRunEnd` not exported from `./index`.

- [ ] **Step 3: Implement**

In `src/telemetry/events.ts`, after the `trackRushRunEnd`/`RushRunEndPayload` block:

```ts
/** Run-level context attached to every Boss `attempt` event, additive to the locked AttemptEventPayload shape above. No `difficulty_served`/`timed_out` (unlike Rush's own RushAttemptContext): Boss has no live difficulty selection and no per-puzzle clock — `position_in_run` alone identifies which fixed-sequence puzzle this was. */
export interface BossAttemptContext {
  run_id: string
  position_in_run: number
}

/** Fires the same `attempt` event as trackAttempt, with Boss's run-level context appended — so Boss attempts land in the same event stream (mode: 'boss') alongside every other mode's. */
export function trackBossAttempt(payload: AttemptEventPayload & BossAttemptContext): void {
  safeCapture('attempt', payload)
}

export interface BossRunEndPayload {
  run_id: string
  /** 1-indexed position of the last puzzle this run reached (whether that puzzle was answered right or wrong), capped at BOSS_RUN.length — see useBossSession's own doc comment ("depth reached"). */
  depth_reached: number
  /** True whenever the run reached the last puzzle in BOSS_RUN, independent of strikes — see the Boss Challenges plan's "Design record" for the exact edge case (3rd strike landing on the final puzzle is still `cleared: true`). */
  cleared: boolean
  /** True when this run's depth_reached just beat the profile's prior all-time bestDepth. */
  is_new_best_depth: boolean
}

/** Fired once per completed Boss run (3 strikes or a full clear), independent of the per-attempt `attempt` events above. */
export function trackBossRunEnd(payload: BossRunEndPayload): void {
  safeCapture('boss_run_end', payload)
}
```

In `src/telemetry/index.ts`:

```ts
export {
  trackSessionStart,
  trackAttempt,
  trackRushAttempt,
  trackRushRunEnd,
  trackBossAttempt,
  trackBossRunEnd,
  trackTraceAttempt,
  trackPuzzleLinkView,
  trackPuzzleLinkAttempt,
  trackShareClick,
  trackStreakPause,
  trackChallengeCreate,
  trackChallengeLinkView,
  trackChallengeLinkComplete,
  trackError,
} from './events'
export type {
  AttemptEventPayload,
  RushAttemptContext,
  RushRunEndPayload,
  BossAttemptContext,
  BossRunEndPayload,
  TraceAttemptContext,
  PuzzleLinkViewPayload,
  PuzzleLinkAttemptPayload,
  ShareClickPayload,
  StreakPausePayload,
  ChallengeCreatePayload,
  ChallengeLinkViewPayload,
  ChallengeLinkCompletePayload,
} from './events'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test telemetry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/events.ts src/telemetry/telemetry.test.ts src/telemetry/index.ts
git commit -m "v3 Phase 1: add trackBossAttempt/trackBossRunEnd telemetry"
```

---

## Task 5: Routing — `/boss` everywhere a route must be registered

**Files:**

- Modify: `src/app/routes.ts`
- Modify: `src/app/routes.test.ts:16` (SW denylist mirror constant)
- Modify: `src/app/App.tsx`
- Modify: `public/_redirects`
- Modify: `vite.config.ts`

**Interfaces:**

- Produces: `ROUTES.boss = { path: '/boss', label: 'Boss' }`, `ROUTE_META['/boss']`.

- [ ] **Step 1: Confirm the failure mode**

`routes.test.ts`'s own drift guards (`SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN` tests, `public/_redirects` tests) already iterate `Object.keys(ROUTE_META)`, so they self-serve once `/boss` is added to `ROUTE_META` — no new test body to write. But the **mirror constant itself** (a hand-synced literal, not derived from `ROUTE_META`) must be updated by hand or its "does not deny the fallback for any known route" test fails for `/boss` once `ROUTE_META` has the new entry. That failure IS this step's red state.

- [ ] **Step 2: Run test to verify it fails (after adding `/boss` to ROUTES/ROUTE_META but before touching the denylist mirror/`_redirects`/`vite.config.ts`)**

Run: `pnpm test routes.test.ts`
Expected: FAIL — `does not deny the fallback for any known route` fails for `/boss`, and the `_redirects` "has a 200 rewrite... for every ROUTE_META route" test fails for `/boss` too.

- [ ] **Step 3: Implement**

In `src/app/routes.ts`:

```ts
export const ROUTES = {
  practice: { path: '/practice', label: 'Practice' },
  daily: { path: '/daily', label: 'Daily' },
  rush: { path: '/rush', label: 'Rush' },
  boss: { path: '/boss', label: 'Boss' },
  trace: { path: '/trace', label: 'Trace' },
  legal: { path: '/legal', label: 'Legal' },
  settings: { path: '/settings', label: 'Settings' },
} as const
```

```ts
  '/rush': {
    title: 'Rush — Codoro',
    description: "Escalating coding puzzles — three strikes and you're out.",
  },
  '/boss': {
    title: 'Boss — Codoro',
    description: "Ten hand-picked puzzles, escalating difficulty — three strikes and the run ends.",
  },
```

In `src/app/routes.test.ts`, update the hand-synced mirror constant (line 16):

```ts
const SW_NAVIGATE_FALLBACK_DENYLIST_PATTERN =
  /^\/(?!(?:practice|daily|rush|boss|browse|legal|trace|challenge|settings|puzzle\/[^/?]+)?(?:\?|$))/
```

In `vite.config.ts`, update the real regex to match (the `navigateFallbackDenylist` array, currently around line 193):

```ts
        navigateFallbackDenylist: [
          /^\/(?!(?:practice|daily|rush|boss|browse|legal|trace|challenge|settings|puzzle\/[^/?]+)?(?:\?|$))/,
```

In `public/_redirects`, add (alongside `/rush`):

```
/rush / 200
/boss / 200
```

In `src/app/App.tsx`, add the lazy import and route (alongside Rush's):

```ts
const bossImporter = () => import('./boss/BossPage')
```

```ts
const BossPage = lazy(async () => ({ default: (await bossImporter()).BossPage }))
```

```tsx
            <Route path="/rush">
              <RushPage />
            </Route>
            <Route path="/boss">
              <BossPage />
            </Route>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test routes.test.ts`
Expected: PASS. (`App.tsx` won't fully typecheck/build until Task 8 creates `src/app/boss/BossPage.tsx` — `pnpm test routes.test.ts` alone doesn't touch `App.tsx`'s import graph, so it's safe to verify green here regardless of task order; run `pnpm typecheck`/`pnpm build` only after Task 8.)

- [ ] **Step 5: Commit**

```bash
git add src/app/routes.ts src/app/routes.test.ts src/app/App.tsx public/_redirects vite.config.ts
git commit -m "v3 Phase 1: register /boss route (routes.ts, App.tsx, _redirects, SW denylist)"
```

---

## Task 6: Nav — `BossIcon`, NavRail, ModeSwitcher

**Files:**

- Modify: `src/app/Icons.tsx`
- Modify: `src/app/Icons.test.tsx`
- Modify: `src/app/NavRail.tsx`
- Modify: `src/app/NavRail.test.tsx`
- Modify: `src/app/ModeSwitcher.tsx`
- Modify: `src/app/ModeSwitcher.test.tsx`

**Interfaces:**

- Consumes: `ROUTES.boss` (Task 5).
- Produces: `BossIcon({ size }: IconProps)`.

- [ ] **Step 1: Write the failing tests**

In `src/app/Icons.test.tsx`, add `BossIcon` to the imports and the `it.each` table:

```ts
import {
  BossIcon,
  CloseIcon,
  CollapseIcon,
  DailyIcon,
  PracticeIcon,
  RatingIcon,
  RushIcon,
  StreakIcon,
  TraceIcon,
} from './Icons'
```

```ts
  it.each([
    ['PracticeIcon', PracticeIcon],
    ['DailyIcon', DailyIcon],
    ['RushIcon', RushIcon],
    ['BossIcon', BossIcon],
    ['TraceIcon', TraceIcon],
    ['CollapseIcon', CollapseIcon],
    ['CloseIcon', CloseIcon],
    ['RatingIcon', RatingIcon],
    ['StreakIcon', StreakIcon],
  ])('%s renders an aria-hidden svg sized by the size prop', (_name, Icon) => {
```

In `src/app/NavRail.test.tsx`, add after the existing Rush navigation test:

```ts
  it('navigates to /boss when Boss is clicked', async () => {
    const user = userEvent.setup()
    render(<NavRail />)

    await user.click(screen.getByRole('link', { name: 'Boss' }))
    expect(window.location.pathname).toBe('/boss')
  })
```

In `src/app/ModeSwitcher.test.tsx`, add after the existing Rush navigation test:

```ts
  it('navigates to /boss when the Boss tab is clicked', async () => {
    const user = userEvent.setup()
    render(<ModeSwitcher />)

    await user.click(screen.getByRole('link', { name: 'Boss' }))
    expect(window.location.pathname).toBe('/boss')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test Icons.test.tsx NavRail.test.tsx ModeSwitcher.test.tsx`
Expected: FAIL — `BossIcon` not exported, no link named "Boss" in either nav component.

- [ ] **Step 3: Implement**

In `src/app/Icons.tsx`, add after `RushIcon`:

```tsx
// Authored fresh for Boss (a trophy — matches the 🏆 shorthand the build
// plan itself uses for the mission chain's boss-run stage), same house
// stroke conventions as every icon above.
export function BossIcon({ size = 20 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M5 4H3v2a4 4 0 0 0 4 3" />
      <path d="M19 4h2v2a4 4 0 0 1-4 3" />
    </svg>
  )
}
```

In `src/app/NavRail.tsx`, add the import and the link, after Rush's entry:

```ts
import { BossIcon, CollapseIcon, DailyIcon, PracticeIcon, RushIcon, TraceIcon } from './Icons'
```

```tsx
      <Link
        href={ROUTES.rush.path}
        className={`nav-rail__item${location === ROUTES.rush.path ? ' nav-rail__item--active' : ''}`}
        aria-current={location === ROUTES.rush.path ? 'page' : undefined}
        aria-label="Rush"
        title="Rush"
      >
        <RushIcon size={20} />
        {!collapsed && <span className="nav-rail__item-label">Rush</span>}
      </Link>
      <Link
        href={ROUTES.boss.path}
        className={`nav-rail__item${location === ROUTES.boss.path ? ' nav-rail__item--active' : ''}`}
        aria-current={location === ROUTES.boss.path ? 'page' : undefined}
        aria-label="Boss"
        title="Boss"
      >
        <BossIcon size={20} />
        {!collapsed && <span className="nav-rail__item-label">Boss</span>}
      </Link>
```

In `src/app/ModeSwitcher.tsx`, add the tab after Rush's:

```tsx
      <Link
        href={ROUTES.rush.path}
        className={`mode-switcher__tab${location === ROUTES.rush.path ? ' mode-switcher__tab--active' : ''}`}
        aria-current={location === ROUTES.rush.path ? 'page' : undefined}
      >
        Rush
      </Link>
      <Link
        href={ROUTES.boss.path}
        className={`mode-switcher__tab${location === ROUTES.boss.path ? ' mode-switcher__tab--active' : ''}`}
        aria-current={location === ROUTES.boss.path ? 'page' : undefined}
      >
        Boss
      </Link>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test Icons.test.tsx NavRail.test.tsx ModeSwitcher.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/Icons.tsx src/app/Icons.test.tsx src/app/NavRail.tsx src/app/NavRail.test.tsx src/app/ModeSwitcher.tsx src/app/ModeSwitcher.test.tsx
git commit -m "v3 Phase 1: add BossIcon and a Boss tab to NavRail/ModeSwitcher"
```

---

## Task 7: `useBossSession` — the session hook

**Files:**

- Create: `src/app/boss/useBossSession.ts`
- Create: `src/app/boss/useBossSession.test.ts`

**Interfaces:**

- Consumes: `BOSS_RUN` (Task 3), `BOSS_STRIKE_LIMIT` (Task 2), `shouldRateAttempt`/`AttemptMode` (Task 2), `quizPool` (`content`), `loadProfile`/`saveProfile`/`appendAttempt` (`storage`), `trackBossAttempt`/`trackBossRunEnd`/`trackError` (`telemetry`), `CommitPayload` (`practice/interactionTypes`).
- Produces: `BossSessionStatus`, `BossPhase`, `BossRunSummary { depthReached: number; cleared: boolean; bestDepthEver: number; isNewBestDepth: boolean }`, `BossSession` interface, `useBossSession(): BossSession`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/boss/useBossSession.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { Puzzle } from '../../content'
import { useBossSession } from './useBossSession'

const { FIXTURE_POOL, BOSS_RUN_IDS } = vi.hoisted(() => {
  const ids = Array.from({ length: 10 }, (_, i) => `b${String(i)}`)
  return {
    BOSS_RUN_IDS: ids,
    FIXTURE_POOL: ids.map((id, i) => ({
      id,
      pattern: 'off-by-one',
      difficulty_rating: 900 + i * 100,
      explanation: `explanation ${id}`,
      prompt: `prompt ${id}`,
      language: 'javascript',
      snippet: 'const x = 1',
      interaction: 'mcq',
      choices: ['a', 'b'],
      correct_choice: 0,
    })) as unknown as Puzzle[],
  }
})

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return { ...actual, puzzlePool: FIXTURE_POOL, quizPool: FIXTURE_POOL, BOSS_RUN: BOSS_RUN_IDS }
})

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return {
    ...actual,
    loadProfile: vi.fn(),
    saveProfile: vi.fn(),
    appendAttempt: vi.fn(),
  }
})

vi.mock('../../telemetry', () => ({
  trackError: vi.fn(),
  trackBossAttempt: vi.fn(),
  trackBossRunEnd: vi.fn(),
}))

vi.mock('../../engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine')>()
  return { ...actual, updateRating: vi.fn(actual.updateRating) }
})

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { updateRating } = await import('../../engine')
const { trackBossAttempt, trackBossRunEnd } = await import('../../telemetry')

function answerAndContinue(
  result: { current: ReturnType<typeof useBossSession> },
  correct: boolean,
) {
  act(() => {
    result.current.handleAnswered({ correct, choiceIndex: correct ? 0 : 1 })
  })
  act(() => {
    result.current.handleContinue()
  })
}

describe('useBossSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves BOSS_RUN[0] first, at position 1', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.puzzle?.id).toBe('b0')
    expect(result.current.position).toBe(1)
    expect(result.current.strikes).toBe(0)
  })

  it('serves BOSS_RUN in fixed order on correct answers', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    answerAndContinue(result, true)
    await waitFor(() => expect(result.current.puzzle?.id).toBe('b1'))
    expect(result.current.position).toBe(2)

    answerAndContinue(result, true)
    await waitFor(() => expect(result.current.puzzle?.id).toBe('b2'))
    expect(result.current.position).toBe(3)
  })

  it('increments strikes on a wrong answer but keeps serving the next puzzle', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    answerAndContinue(result, false)
    await waitFor(() => expect(result.current.strikes).toBe(1))
    expect(result.current.phase).toBe('playing')
    expect(result.current.puzzle?.id).toBe('b1')
  })

  it('ends the run on the 3rd strike, reporting depthReached and cleared: false', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    answerAndContinue(result, false)
    await waitFor(() => expect(result.current.position).toBe(2))
    answerAndContinue(result, false)
    await waitFor(() => expect(result.current.position).toBe(3))
    answerAndContinue(result, false)

    await waitFor(() => expect(result.current.phase).toBe('ended'))
    expect(result.current.runSummary).toEqual({
      depthReached: 3,
      cleared: false,
      bestDepthEver: 3,
      isNewBestDepth: true,
    })
    expect(trackBossRunEnd).toHaveBeenCalledWith(
      expect.objectContaining({ depth_reached: 3, cleared: false, is_new_best_depth: true }),
    )
  })

  it('ends the run after the 10th puzzle with cleared: true', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    for (let i = 0; i < 9; i++) {
      answerAndContinue(result, true)
      await waitFor(() => expect(result.current.position).toBe(i + 2))
    }
    answerAndContinue(result, true)

    await waitFor(() => expect(result.current.phase).toBe('ended'))
    expect(result.current.runSummary).toEqual({
      depthReached: 10,
      cleared: true,
      bestDepthEver: 10,
      isNewBestDepth: true,
    })
  })

  it('never rates — updateRating is never called across a full run including wrong answers', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    answerAndContinue(result, true)
    await waitFor(() => expect(result.current.position).toBe(2))
    answerAndContinue(result, false)
    await waitFor(() => expect(result.current.strikes).toBe(1))

    expect(updateRating).not.toHaveBeenCalled()
  })

  it('records every attempt with mode "boss" and the correct run-level telemetry context', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    answerAndContinue(result, true)
    await waitFor(() => expect(result.current.position).toBe(2))

    expect(appendAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'boss', puzzleId: 'b0' }),
    )
    expect(trackBossAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'boss', puzzle_id: 'b0', position_in_run: 1 }),
    )
  })

  it('"Run it back" starts a fresh run from position 1 with strikes reset', async () => {
    const { result } = renderHook(() => useBossSession())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    for (let i = 0; i < 3; i++) {
      answerAndContinue(result, false)
      await waitFor(() => expect(result.current.strikes).toBe(i + 1))
    }
    await waitFor(() => expect(result.current.phase).toBe('ended'))

    act(() => {
      result.current.handleRunItBack()
    })

    await waitFor(() => expect(result.current.phase).toBe('playing'))
    expect(result.current.puzzle?.id).toBe('b0')
    expect(result.current.position).toBe(1)
    expect(result.current.strikes).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test useBossSession.test.ts`
Expected: FAIL — `./useBossSession` doesn't resolve.

- [ ] **Step 3: Implement**

Create `src/app/boss/useBossSession.ts`:

```ts
/**
 * Orchestrates the Boss loop: serve BOSS_RUN in fixed order, 3-strikes-ends-
 * it (BOSS_STRIKE_LIMIT), best-depth-ever persistence. Deliberately much
 * simpler than useRushSession: no per-puzzle clock (Boss's settled design
 * questions never call for one — see the Boss Challenges plan's design
 * record), and no live difficulty selection (the run order is fixed, see
 * bossRun.ts) — so there's no widening pool, no rng, no interval/
 * visibilitychange machinery to manage.
 *
 * "Depth reached" is the run's score: the 1-indexed position of the last
 * puzzle the run reached, whether that puzzle was answered right or wrong,
 * capped at BOSS_RUN.length. `cleared` is true whenever depth reached ===
 * BOSS_RUN.length, independent of strikes — a run whose 3rd strike lands
 * exactly on the 10th puzzle still reports cleared: true (it did reach the
 * end of the sequence) even though ended_reason still reports 'strikes'
 * (that's what actually ended it). Both facts are real; neither is dropped.
 *
 * Boss is unrated by construction, not by omission: shouldRateAttempt
 * (rating.ts) hardcodes `mode === 'boss' -> false`, so `rates` below is
 * always false and the `updateRating` call is provably dead code —
 * identical structure to useRushSession's own guard. See this file's own
 * test's "never rates" describe block.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { BOSS_STRIKE_LIMIT, shouldRateAttempt, updateRating } from '../../engine'
import { appendAttempt, loadProfile, saveProfile } from '../../storage'
import type { Attempt, BossStats, UserProfile } from '../../storage'
import { quizPool, BOSS_RUN } from '../../content'
import { resolvePool } from '../devTools/devPuzzleMode'
import type { Puzzle as ContentPuzzle } from '../../content'
import { trackError, trackBossAttempt, trackBossRunEnd } from '../../telemetry'
import type { CommitPayload } from '../practice/interactionTypes'

/** Local calendar-date string (YYYY-MM-DD) — same convention as every other session hook. */
function todayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

export type BossSessionStatus = 'loading' | 'ready' | 'empty' | 'error'
export type BossPhase = 'playing' | 'ended'

export interface BossRunSummary {
  depthReached: number
  cleared: boolean
  /** All-time deepest run, post this run's update. */
  bestDepthEver: number
  /** True when this run's depthReached just beat the profile's prior all-time bestDepth. */
  isNewBestDepth: boolean
}

export interface BossSession {
  status: BossSessionStatus
  phase: BossPhase
  profile: UserProfile | null
  puzzle: ContentPuzzle | null
  strikes: number
  /** 1-indexed position of the currently served puzzle within BOSS_RUN. */
  position: number
  /** Populated once phase === 'ended'. */
  runSummary: BossRunSummary | null
  handleAnswered: (payload: CommitPayload) => void
  handleContinue: () => void
  handleRunItBack: () => void
  retryLoad: () => void
}

export function useBossSession(): BossSession {
  const [status, setStatus] = useState<BossSessionStatus>('loading')
  const [phase, setPhase] = useState<BossPhase>('playing')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [puzzle, setPuzzle] = useState<ContentPuzzle | null>(null)
  const [strikes, setStrikes] = useState(0)
  const [position, setPosition] = useState(0)
  const [runSummary, setRunSummary] = useState<BossRunSummary | null>(null)

  const runIdRef = useRef(crypto.randomUUID())
  const servedAtRef = useRef(0)
  const pendingEndRef = useRef(false)
  const pendingNextIndexRef = useRef(0)
  const cancelledRef = useRef(false)

  const activePool = resolvePool(quizPool)
  const contentById = useRef(new Map(activePool.map((p) => [p.id, p])))

  const serveAt = useCallback((index: number) => {
    const id = BOSS_RUN[index]
    if (id === undefined) {
      setPuzzle(null)
      setStatus('empty')
      return
    }
    const fullPuzzle = contentById.current.get(id)
    if (!fullPuzzle) {
      setPuzzle(null)
      setStatus('empty')
      return
    }
    setPuzzle(fullPuzzle)
    setPosition(index + 1)
    servedAtRef.current = Date.now()
    setStatus('ready')
  }, [])

  const startRun = useCallback(() => {
    runIdRef.current = crypto.randomUUID()
    pendingEndRef.current = false
    pendingNextIndexRef.current = 0
    setPhase('playing')
    setStrikes(0)
    setRunSummary(null)
    serveAt(0)
  }, [serveAt])

  useEffect(() => {
    cancelledRef.current = false
    void (async () => {
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        setProfile(loaded)
        startRun()
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useBossSession: loadProfile failed on mount')
        setStatus('error')
      }
    })()
    return () => {
      cancelledRef.current = true
    }
    // Mount-only, same convention as useRushSession.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retryLoad = useCallback(() => {
    cancelledRef.current = false
    setStatus('loading')
    void (async () => {
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        setProfile(loaded)
        startRun()
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useBossSession: loadProfile failed on mount')
        setStatus('error')
      }
    })()
  }, [startRun])

  const endRun = useCallback((currentProfile: UserProfile, finalPosition: number) => {
    const cleared = finalPosition >= BOSS_RUN.length
    const priorStats = currentProfile.bossStats
    const isNewBestDepth = finalPosition > (priorStats?.bestDepth ?? 0)
    const newBossStats: BossStats = {
      bestDepth: Math.max(priorStats?.bestDepth ?? 0, finalPosition),
      clears: (priorStats?.clears ?? 0) + (cleared ? 1 : 0),
      runs: (priorStats?.runs ?? 0) + 1,
      lastRunAt: new Date().toISOString(),
    }
    const updatedProfile: UserProfile = { ...currentProfile, bossStats: newBossStats }
    setProfile(updatedProfile)
    saveProfile(updatedProfile).catch((error: unknown) => {
      trackError(error, 'useBossSession: saveProfile failed')
    })
    trackBossRunEnd({
      run_id: runIdRef.current,
      depth_reached: finalPosition,
      cleared,
      is_new_best_depth: isNewBestDepth,
    })
    setRunSummary({
      depthReached: finalPosition,
      cleared,
      bestDepthEver: newBossStats.bestDepth,
      isNewBestDepth,
    })
    setPhase('ended')
  }, [])

  const handleAnswered = useCallback(
    (payload: CommitPayload) => {
      if (!profile || !puzzle || phase !== 'playing') return

      const timeMs = Math.max(0, Date.now() - servedAtRef.current)
      const today = todayDateString()

      // Boss never rates — see this file's doc comment.
      const rates = shouldRateAttempt('boss', false)
      const oldRating = profile.rating
      const newRating = rates
        ? updateRating(
            oldRating,
            puzzle.difficulty_rating,
            payload.correct,
            profile.ratedAttemptCount,
          )
        : oldRating

      const attempt: Attempt = {
        id: crypto.randomUUID(),
        puzzleId: puzzle.id,
        puzzleRating: puzzle.difficulty_rating,
        mode: 'boss',
        correct: payload.correct,
        time_ms: timeMs,
        choice_index: payload.choiceIndex,
        checkpoint_results: null,
        userRatingBefore: oldRating,
        userRatingAfter: newRating,
        localDateString: today,
        createdAt: new Date().toISOString(),
      }

      appendAttempt(attempt).catch((error: unknown) => {
        trackError(error, 'useBossSession: appendAttempt failed')
      })

      trackBossAttempt({
        puzzle_id: puzzle.id,
        correct: payload.correct,
        time_ms: timeMs,
        mode: 'boss',
        interaction: puzzle.interaction,
        user_rating_before: oldRating,
        user_rating_after: newRating,
        run_id: runIdRef.current,
        position_in_run: position,
      })

      const newStrikes = payload.correct ? strikes : strikes + 1
      setStrikes(newStrikes)

      const reachedEnd = position >= BOSS_RUN.length
      pendingEndRef.current = newStrikes >= BOSS_STRIKE_LIMIT || reachedEnd
      pendingNextIndexRef.current = position
    },
    [profile, puzzle, phase, strikes, position],
  )

  const handleContinue = useCallback(() => {
    if (!profile || phase !== 'playing') return
    if (pendingEndRef.current) {
      endRun(profile, position)
      return
    }
    serveAt(pendingNextIndexRef.current)
  }, [profile, phase, position, serveAt, endRun])

  const handleRunItBack = useCallback(() => {
    if (!profile) return
    startRun()
  }, [profile, startRun])

  return {
    status,
    phase,
    profile,
    puzzle,
    strikes,
    position,
    runSummary,
    handleAnswered,
    handleContinue,
    handleRunItBack,
    retryLoad,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test useBossSession.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/boss/useBossSession.ts src/app/boss/useBossSession.test.ts
git commit -m "v3 Phase 1: add useBossSession"
```

---

## Task 8: `BossPage` — the page component

**Files:**

- Create: `src/app/boss/BossPage.tsx`
- Create: `src/app/boss/bossPage.css`
- Create: `src/app/boss/BossPage.test.tsx`

**Interfaces:**

- Consumes: `useBossSession` (Task 7), `PuzzleCardShell` (`practice/PuzzleCardShell`), `BossIcon` (Task 6), `BOSS_RUN` (Task 3, for the "of 10" display).

- [ ] **Step 1: Write the failing tests**

Create `src/app/boss/BossPage.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Puzzle } from '../../content'

const { FIXTURE_POOL, BOSS_RUN_IDS } = vi.hoisted(() => {
  const ids = Array.from({ length: 10 }, (_, i) => `b${String(i)}`)
  return {
    BOSS_RUN_IDS: ids,
    FIXTURE_POOL: ids.map((id, i) => ({
      id,
      pattern: 'off-by-one',
      difficulty_rating: 900 + i * 100,
      explanation: `explanation ${id}`,
      prompt: `prompt ${id}`,
      language: 'javascript',
      snippet: 'const x = 1',
      interaction: 'mcq',
      choices: ['a', 'b'],
      correct_choice: 0,
    })) as unknown as Puzzle[],
  }
})

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return { ...actual, puzzlePool: FIXTURE_POOL, quizPool: FIXTURE_POOL, BOSS_RUN: BOSS_RUN_IDS }
})

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return {
    ...actual,
    loadProfile: vi.fn(),
    saveProfile: vi.fn(),
    appendAttempt: vi.fn(),
  }
})

vi.mock('../../telemetry', () => ({
  trackError: vi.fn(),
  trackBossAttempt: vi.fn(),
  trackBossRunEnd: vi.fn(),
}))

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { BossPage } = await import('./BossPage')

async function answerAndContinue(user: ReturnType<typeof userEvent.setup>, correct: boolean) {
  await user.click(await screen.findByRole('button', { name: correct ? 'a' : 'b' }))
  await user.click(await screen.findByRole('button', { name: 'Continue' }))
}

describe('BossPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
  })

  it('shows the strikes indicator and puzzle 1 of 10 once ready', async () => {
    render(<BossPage />)
    await waitFor(() => {
      expect(screen.getByRole('status', { name: /0 of 3 strikes/i })).toBeInTheDocument()
    })
    expect(screen.getByText(/puzzle 1 of 10/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'a' })).toBeInTheDocument()
  })

  it('advances to puzzle 2 of 10 on a correct answer', async () => {
    const user = userEvent.setup()
    render(<BossPage />)
    await waitFor(() => screen.getByRole('button', { name: 'a' }))

    await answerAndContinue(user, true)
    await waitFor(() => {
      expect(screen.getByText(/puzzle 2 of 10/i)).toBeInTheDocument()
    })
  })

  it('shows the end-of-run summary after 3 strikes, with Run it back to replay', async () => {
    const user = userEvent.setup()
    render(<BossPage />)
    await waitFor(() => screen.getByRole('button', { name: 'a' }))

    await answerAndContinue(user, false)
    await answerAndContinue(user, false)
    await answerAndContinue(user, false)

    await waitFor(() => {
      expect(screen.getByText(/run complete/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Run it back' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test BossPage.test.tsx`
Expected: FAIL — `./BossPage` doesn't resolve.

- [ ] **Step 3: Implement**

Create `src/app/boss/bossPage.css`:

```css
/*
 * Boss's own layout. Deliberately does NOT reuse Rush's .rush-strikes/
 * .rush-timer-row wholesale: every prior cross-mode CSS reuse in this
 * codebase (Rush reusing Daily's .daily-hero/.status-bar) reused GLOBAL
 * page CSS already loaded independent of which mode's own chunk loaded
 * (see rushPage.css's own doc comment) — rushPage.css itself is Rush's own
 * page-specific, lazily-chunked CSS, not guaranteed loaded when Boss's own
 * chunk loads. The strikes-indicator pattern is small (a dozen lines);
 * duplicating it here under Boss's own class names is cheaper and more
 * self-contained than cross-importing another mode's page CSS file for one
 * shared visual pattern — no other example of that exists in this codebase.
 * The end-of-run hero still reuses .daily-hero/.status-bar directly (global
 * CSS, same as Rush's own reuse).
 */
.boss-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.boss-page__status {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--muted);
}

.boss-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.boss-strikes {
  display: flex;
  gap: 0.375rem;
}

.boss-strikes__slot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 999px;
  background: var(--border);
}

.boss-strikes__slot--missed {
  background: var(--danger);
}

.boss-progress {
  font-size: 0.875rem;
  color: var(--muted);
}
```

Create `src/app/boss/BossPage.tsx`:

```tsx
/**
 * Boss mode: a fixed 10-puzzle escalating run, 3 strikes ends it. Composed
 * from the same existing patterns Rush's own page comment documents using:
 * PuzzleCardShell for the puzzle itself, the .daily-hero/.status-bar
 * treatment for the end-of-run summary (global CSS, already loaded whenever
 * DailyPage is reachable — see RushPage.tsx's own doc comment for why that's
 * safe to reuse verbatim). The strikes indicator is Boss's own small CSS
 * (see bossPage.css's doc comment for why it isn't literally rushPage.css's
 * classes). No timer row (Boss has no per-puzzle clock — see the Boss
 * Challenges plan's design record) and no share/challenge cards this phase
 * (not in Phase 1's build item list — a deliberate scope decision, see the
 * same plan).
 */
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { BossIcon } from '../Icons'
import { BOSS_RUN } from '../../content'
import { useBossSession } from './useBossSession'
import './bossPage.css'

export function BossPage() {
  const session = useBossSession()

  if (session.status === 'error') {
    return (
      <div className="boss-page app-shell__main">
        <p className="boss-page__status">We couldn&apos;t load Boss. Please try again.</p>
        <button type="button" className="daily-page__link" onClick={session.retryLoad}>
          Try again
        </button>
      </div>
    )
  }

  if (session.status === 'loading' || session.profile === null) {
    return (
      <div className="boss-page app-shell__main">
        <p className="boss-page__status">Loading Boss…</p>
      </div>
    )
  }

  if (session.status === 'empty') {
    return (
      <div className="boss-page app-shell__main">
        <p className="boss-page__status">Boss isn&apos;t available right now.</p>
      </div>
    )
  }

  return (
    <div className="boss-page app-shell__main">
      {session.phase === 'playing' && (
        <div className="boss-header">
          <div
            className="boss-strikes"
            role="status"
            aria-label={`${String(session.strikes)} of 3 strikes`}
          >
            {[0, 1, 2].map((slot) => (
              <span
                key={slot}
                className={`boss-strikes__slot${
                  slot < session.strikes ? ' boss-strikes__slot--missed' : ''
                }`}
                aria-hidden="true"
              />
            ))}
          </div>
          <span className="boss-progress">
            Puzzle {session.position} of {BOSS_RUN.length}
          </span>
        </div>
      )}

      {session.phase === 'ended' && session.runSummary && (
        <>
          <div className="daily-hero">
            <div className="daily-hero__top">
              <div className="daily-hero__icon" aria-hidden="true">
                <BossIcon size={22} />
              </div>
              <div className="daily-hero__copy">
                <p className="daily-hero__verdict">
                  {session.runSummary.cleared ? 'Boss cleared!' : 'Run complete'}
                </p>
                {session.runSummary.isNewBestDepth && (
                  <p className="daily-hero__badge">New personal best</p>
                )}
              </div>
            </div>
            <div className="daily-hero__stats">
              <div className="daily-hero__stat">
                <span className="daily-hero__stat-value">{session.runSummary.depthReached}</span>
                <span className="daily-hero__stat-label">Reached</span>
              </div>
              <div className="daily-hero__stat">
                <span className="daily-hero__stat-value">{session.runSummary.bestDepthEver}</span>
                <span className="daily-hero__stat-label">Best ever</span>
              </div>
            </div>
          </div>

          <button type="button" className="share-card__button" onClick={session.handleRunItBack}>
            Run it back
          </button>
        </>
      )}

      {session.phase === 'playing' && session.puzzle && (
        <PuzzleCardShell
          key={session.puzzle.id}
          puzzle={session.puzzle}
          ratingDelta={null}
          onAnswered={session.handleAnswered}
          onContinue={session.handleContinue}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test BossPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/boss/BossPage.tsx src/app/boss/bossPage.css src/app/boss/BossPage.test.tsx
git commit -m "v3 Phase 1: add BossPage"
```

---

## Task 9: Full integration — `pnpm validate` green, DoD amendment

**Files:**

- Modify: `docs/v3-build-plan.md` (Phase 1's DoD checkboxes + a written amendment)

**Interfaces:** none new — this task is verification + documentation only.

- [ ] **Step 1: Run the full validation chain**

Run: `pnpm validate`
Expected: typecheck, lint, every test file (including the new ones from Tasks 1-8), `validate:content` (BOSS_RUN passes `validateBossRun`), and `build` all green. Fix anything red that surfaces here but wasn't caught task-by-task (e.g. another hardcoded `UserProfile` fixture elsewhere in the suite missing `bossStats`) — this is exactly the kind of cross-task integration gap task-by-task TDD can miss.

- [ ] **Step 2: Manual smoke check**

Run: `pnpm dev`, navigate to `/boss` (both NavRail at desktop width and ModeSwitcher at mobile width), play through a full run both ways (3 strikes, and a full 10-puzzle clear) to confirm the UI reads correctly — the "playable end-to-end on desktop and mobile widths" DoD line, which no automated test fully covers (real viewport rendering).

- [ ] **Step 3: Write the Phase 1 amendment and close the DoD**

In `docs/v3-build-plan.md`, under Phase 1, add an amendment (mirroring Phase 0's amendment style — dated, citing what was observed) recording:

- The run-assembly decision (single `BOSS_RUN`, no multi-set selection engine this phase) and the explicit flag that more sets are known near-term follow-up.
- The `bossStats` schema bump (v6→v7).
- The scope decision to omit BossShareCard/BossChallengeCard this phase.
- `pnpm validate` green, confirmed with the actual command output.

Check off the DoD boxes that are now genuinely met (leave any unmet line unchecked with a note, per this doc's own "undecided is valid, silent is not" rule):

```markdown
**DoD:**

- [x] Boss mode playable end-to-end on desktop and mobile widths; run assembly deterministic (seeded) and covered by pool-level tests — **met, <today's date>**: manual smoke pass at both widths; `bossRun.test.ts` + `validateBossRun` cover the real pool.
- [x] Design questions 1–4 answered in a written amendment here, with reasoning — the v2 standard for decision records — **met, 2026-08-10** (see "Design questions — settled" above)
- [x] Schema bump (if any) has an isolated migration test; export/import round-trips the new fields — **met, <today's date>**: v6->v7 (`bossStats`), isolated test in `migrations.test.ts`, `exportImport.test.ts` fixtures updated.
- [x] Telemetry events verified firing locally; `pnpm validate` green; `validate:content` untouched or updated deliberately — **met, <today's date>**: `boss_run_end` + `attempt` (mode: 'boss') verified via `telemetry.test.ts` and a local `pnpm dev` smoke pass; `validate:content` deliberately extended with `validateBossRun`.
```

- [ ] **Step 4: N/A (documentation task — nothing further to run/verify beyond Step 1's `pnpm validate`)**

- [ ] **Step 5: Commit**

```bash
git add docs/v3-build-plan.md
git commit -m "v3 Phase 1: close Boss challenges DoD, record amendment"
```

---

## Self-review notes (for whoever executes this plan)

- **Spec coverage:** every Phase 1 build item (route+page+hook, run assembly, storage, telemetry, payoff surface) and every DoD line is covered by a task above. The one deliberate exception (share/challenge cards) is flagged explicitly in the Design record, not silently dropped.
- **Known gap flagged per Thomas's request:** `bossRun.ts`'s doc comment (Task 3) and this plan's Design record both state plainly that Boss will need more than one curated set soon — that's not a task in this plan (out of scope by direct decision), but it's written down where the next session will find it.
- **Type consistency check:** `BossSession`/`BossRunSummary`/`BossStats`/`BossAttemptContext`/`BossRunEndPayload` field names are used identically across Tasks 1, 4, 7, and 8 (`depthReached`/`depth_reached`, `bestDepthEver`, `isNewBestDepth`/`is_new_best_depth`, `cleared`) — verified no drift between the storage shape, the telemetry payload, and the hook's own return type.
