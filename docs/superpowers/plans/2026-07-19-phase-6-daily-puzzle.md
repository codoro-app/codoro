# Phase 6 — Daily Puzzle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Daily mode — one deterministic puzzle per calendar date, first-attempt-only rating, a Daily-only streak, a Wordle-style clipboard share card, and OG meta tags so shared links unfurl.

**Architecture:** Daily mirrors Practice's existing orchestration-hook-plus-thin-shell shape (`useDailySession` + `DailyPage`, reusing `PuzzleCardShell` unmodified). Streak semantics move fully off Practice's commit flow and onto Daily's first-attempt-of-day commit. A new `dailyCompletion` field on `UserProfile` (schema v1→v2, with a real migration) is the single source of truth for "already rated today" and drives both the rating gate and the share card. `App.tsx` gains a minimal two-tab mode switcher (no routing library) to reach Daily at all.

**Tech Stack:** React 19, TypeScript, Zod (storage schema), Vitest + Testing Library, `idb` (IndexedDB), `sharp` (OG image raster), Vite/vite-plugin-pwa (unchanged).

## Global Constraints

- Branch `phase-6-daily`, PR into `main` when green. `main` is confirmed at `81bc69f` (PR #14) as of plan-writing time.
- No Claude/Anthropic/AI attribution in commit messages — write them as if authored normally (matches the task brief).
- **Do not touch `src/app/pwa/`, service worker registration, or `public/_headers`.** If any task in this plan turns out to require touching those (it shouldn't), stop and flag it instead of proceeding.
- No routing library — the mode switcher is two buttons and a `useState`.
- `Attempt.mode`, `shouldRateAttempt`, `getDailyPuzzleIndex` already exist and are correct — call them, do not reimplement them.
- Every storage-shape change must go through `MIGRATIONS` — never silently reinterpret old data.
- Loop per task: build, verify (tests + typecheck), commit, move to the next. No batching multiple tasks into one commit.
- `pnpm validate` (`typecheck && lint && test && validate:content && build`) must be green before the branch is considered done.

---

### Task 1: Bump the profile schema to v2 and add `dailyCompletion`

**Files:**

- Modify: `src/storage/schema.ts`
- Modify: `src/storage/schema.test.ts`

**Interfaces:**

- Produces: `DailyCompletionSchema` (Zod), `DailyCompletion` (TS interface: `{ date: string; attemptId: string; correct: boolean }`), `UserProfile.dailyCompletion: DailyCompletion | null`, `CURRENT_SCHEMA_VERSION = 2`.

- [ ] **Step 1: Write the failing tests**

Add to `src/storage/schema.test.ts`, inside the existing `describe('UserProfileSchema', ...)` block (after the existing tests), and update `validProfile`:

```ts
const validProfile = {
  schema_version: CURRENT_SCHEMA_VERSION,
  rating: 1247.5,
  ratedAttemptCount: 3,
  streak: { currentStreak: 2, longestStreak: 5, lastActiveDate: '2026-07-15' },
  requeueState: [{ puzzleId: 'p1', stage: 1, served: 4 }],
  storagePersisted: true,
  dailyCompletion: { date: '2026-07-19', attemptId: 'a1', correct: true },
}
```

(This replaces the existing `validProfile` const at the top of the file — same object, plus the new field.)

Then add these new `it` blocks inside `describe('UserProfileSchema', ...)`:

```ts
it('accepts a null dailyCompletion (no attempt today yet)', () => {
  const parsed = UserProfileSchema.parse({ ...validProfile, dailyCompletion: null })
  expect(parsed.dailyCompletion).toBeNull()
})

it('rejects a dailyCompletion missing required fields', () => {
  expect(() =>
    UserProfileSchema.parse({ ...validProfile, dailyCompletion: { date: '2026-07-19' } }),
  ).toThrow()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test schema.test.ts`
Expected: FAIL — `dailyCompletion` does not exist on the schema yet (`validProfile` fails to parse cleanly / new assertions throw on missing field).

- [ ] **Step 3: Implement the schema change**

In `src/storage/schema.ts`:

Change:

```ts
export const CURRENT_SCHEMA_VERSION = 1
```

to:

```ts
export const CURRENT_SCHEMA_VERSION = 2
```

Add after `RequeueStateSchema`:

```ts
/** Which daily puzzle (by calendar date) already has a recorded first attempt this day — the rating/streak/share gate for Daily mode. */
export const DailyCompletionSchema = z.object({
  date: z.string().min(1),
  attemptId: z.string().min(1),
  correct: z.boolean(),
})
```

In `UserProfileSchema`, add a field after `storagePersisted`:

```ts
  storagePersisted: z.boolean().nullable(),
  dailyCompletion: DailyCompletionSchema.nullable(),
})
```

Add the matching hand-written type near `StreakState`'s usage (after the `RequeueEntrySchema`/`RequeueStateSchema` types, before `UserProfileSchema`'s interface):

```ts
export interface DailyCompletion {
  date: string
  attemptId: string
  correct: boolean
}
```

Update the `UserProfile` interface:

```ts
export interface UserProfile {
  schema_version: number
  rating: number
  /** Feeds engine's getK as priorRatedAttemptCount. */
  ratedAttemptCount: number
  streak: StreakState
  requeueState: RequeueState
  storagePersisted: boolean | null
  /** Non-null once today's Daily puzzle has a recorded first (rated) attempt. Date-scoped: a stale date from a previous day means "not completed today" even though the field is non-null. */
  dailyCompletion: DailyCompletion | null
}
```

Update `createDefaultProfile()`:

```ts
export function createDefaultProfile(): UserProfile {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    rating: INITIAL_RATING,
    ratedAttemptCount: 0,
    streak: { currentStreak: 0, longestStreak: 0, lastActiveDate: null },
    requeueState: emptyRequeueState,
    storagePersisted: null,
    dailyCompletion: null,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test schema.test.ts`
Expected: PASS (all existing + new assertions).

- [ ] **Step 5: Commit**

```bash
git add src/storage/schema.ts src/storage/schema.test.ts
git commit -m "Add dailyCompletion to UserProfile, bump schema to v2"
```

---

### Task 2: Write the v1→v2 migration

**Files:**

- Modify: `src/storage/migrations.ts`
- Modify: `src/storage/migrations.test.ts`

**Interfaces:**

- Consumes: `Migration` type, `runMigrations` (both already exist, unchanged).
- Produces: `MIGRATIONS[1]` — a real migration from schema v1 to v2.

- [ ] **Step 1: Write the failing test**

Add to `src/storage/migrations.test.ts`, a new top-level `describe` block after the existing `describe('runMigrations', ...)`:

```ts
describe('MIGRATIONS[1]: v1 -> v2 (adds dailyCompletion)', () => {
  it('stamps schema_version 2, adds a null dailyCompletion, and preserves every existing field untouched', () => {
    const v1Profile = {
      schema_version: 1,
      rating: 1342.75,
      ratedAttemptCount: 7,
      streak: { currentStreak: 3, longestStreak: 9, lastActiveDate: '2026-07-14' },
      requeueState: [{ puzzleId: 'p9', stage: 2, served: 12 }],
      storagePersisted: true,
    }

    const migrated = runMigrations(v1Profile, 1, MIGRATIONS)

    expect(migrated).toEqual({
      ...v1Profile,
      schema_version: 2,
      dailyCompletion: null,
    })
  })
})
```

Update the file's top import line from:

```ts
import { runMigrations } from './migrations'
```

to:

```ts
import { MIGRATIONS, runMigrations } from './migrations'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test migrations.test.ts`
Expected: FAIL — `MIGRATIONS` is `{}`, so `runMigrations` returns the input unchanged (`schema_version` stays `1`, no `dailyCompletion`).

- [ ] **Step 3: Implement the migration**

Replace the bottom of `src/storage/migrations.ts` (the empty `MIGRATIONS` export and its doc comment):

```ts
/**
 * v1 -> v2: adds `dailyCompletion` (nullable) for Phase 6's Daily mode —
 * see src/storage/schema.ts's UserProfile doc comment. Every existing field
 * is passed through unchanged; this migration only adds the new one.
 */
function migrateV1ToV2(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, schema_version: 2, dailyCompletion: null }
}

/**
 * Keyed by the version each migration migrates *from*. The first real entry:
 * schema v1 predates Daily mode, so any profile still on v1 gets a null
 * dailyCompletion (equivalent to "no Daily attempt recorded yet").
 */
export const MIGRATIONS: Record<number, Migration> = {
  1: migrateV1ToV2,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test migrations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/migrations.ts src/storage/migrations.test.ts
git commit -m "Add the v1 -> v2 profile migration for dailyCompletion"
```

---

### Task 3: Prove the migration runs end-to-end through `loadProfile`, and fix the now-broken fixtures

**Files:**

- Modify: `src/storage/profile.test.ts`

**Interfaces:**

- Consumes: `loadProfile`, `saveProfile` (unchanged signatures), `UserProfile` (now has `dailyCompletion`).

This is the "real migration test" the brief asks for: a v1 fixture written directly into (fake) IndexedDB, loaded under the v2 schema, asserting the migrated shape — proving existing users' `rating`/`ratedAttemptCount`/`streak` survive the bump untouched.

- [ ] **Step 1: Write the failing tests**

In `src/storage/profile.test.ts`, update the existing round-trip test's fixture (it currently hardcodes `schema_version: 1` with no `dailyCompletion`, which now fails `saveProfile`'s validation):

```ts
it('round-trips a saved profile exactly', async () => {
  const profile: UserProfile = {
    schema_version: 2,
    rating: 1342.75,
    ratedAttemptCount: 7,
    streak: { currentStreak: 3, longestStreak: 9, lastActiveDate: '2026-07-14' },
    requeueState: [{ puzzleId: 'p9', stage: 2, served: 12 }],
    storagePersisted: true,
    dailyCompletion: { date: '2026-07-14', attemptId: 'a1', correct: true },
  }
  await saveProfile(profile)
  expect(await loadProfile()).toEqual(profile)
})
```

Add a new test in a new `describe` block at the end of the file:

```ts
describe('schema migration on load', () => {
  it('migrates a v1 stored profile to v2 on load, preserving rating/streak/ratedAttemptCount and persisting the upgrade', async () => {
    const v1Profile = {
      schema_version: 1,
      rating: 1389.25,
      ratedAttemptCount: 14,
      streak: { currentStreak: 6, longestStreak: 11, lastActiveDate: '2026-07-18' },
      requeueState: [{ puzzleId: 'p3', stage: 0, served: 1 }],
      storagePersisted: true,
    }
    await withDb((db) => db.put(PROFILE_STORE, v1Profile, PROFILE_KEY))

    const migrated = await loadProfile()

    expect(migrated).toEqual({
      ...v1Profile,
      schema_version: 2,
      dailyCompletion: null,
    })

    // Persisted as v2, not just returned in memory — re-reading straight
    // from disk must not trigger the migration path a second time.
    const stored = await withDb<unknown>((db) => db.get(PROFILE_STORE, PROFILE_KEY))
    expect(stored).toEqual(migrated)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test profile.test.ts`
Expected: FAIL — the round-trip test throws on `saveProfile` (schema_version literal mismatch, missing `dailyCompletion`) until Tasks 1–2 are in place; the new migration test exercises the same path.

- [ ] **Step 3: No production code change needed**

`loadProfile` in `src/storage/profile.ts` already routes any `schema_version < CURRENT_SCHEMA_VERSION` through `runMigrations` — this task only needed the fixtures/tests updated to match Tasks 1–2's schema change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/profile.test.ts
git commit -m "Test the v1 -> v2 migration end-to-end through loadProfile"
```

---

### Task 4: Add `getDailyNumber` to the engine's `daily.ts`

**Files:**

- Modify: `src/engine/daily.ts`
- Modify: `src/engine/daily.test.ts`
- Modify: `src/engine/index.ts`

**Interfaces:**

- Consumes: `daysBetween` from `./streak` (already exists, pure date-string math).
- Produces: `DAILY_EPOCH: string`, `getDailyNumber(dateString: string): number` — the "Daily #N" shown in the share text. **Not** used for puzzle selection (that stays keyed off the date string itself via `getDailyPuzzleIndex`, unaffected by this task).

- [ ] **Step 1: Write the failing tests**

In `src/engine/daily.test.ts`, update the top import line from:

```ts
import { getDailyPuzzleIndex, hashDateString } from './daily'
```

to:

```ts
import { DAILY_EPOCH, getDailyNumber, getDailyPuzzleIndex, hashDateString } from './daily'
```

Add a new `describe` block:

```ts
describe('getDailyNumber', () => {
  it('returns 1 on the epoch date itself', () => {
    expect(getDailyNumber(DAILY_EPOCH)).toBe(1)
  })

  it('increases by exactly 1 per elapsed calendar day', () => {
    const n1 = getDailyNumber(DAILY_EPOCH)
    const dayAfter = new Date(`${DAILY_EPOCH}T00:00:00Z`)
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1)
    const n2 = getDailyNumber(dayAfter.toISOString().slice(0, 10))
    expect(n2).toBe(n1 + 1)
  })

  it('is deterministic for the same date string', () => {
    expect(getDailyNumber('2026-07-19')).toBe(getDailyNumber('2026-07-19'))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test daily.test.ts`
Expected: FAIL — `DAILY_EPOCH` / `getDailyNumber` don't exist yet (import error).

- [ ] **Step 3: Implement**

In `src/engine/daily.ts`, add after the existing top-of-file doc comment:

```ts
import { daysBetween } from './streak'

/**
 * First calendar date Daily mode is considered "live" — Day #1 in the share
 * text ("Codoro Daily #N"). Purely cosmetic: changing this only shifts the
 * displayed day number, never which puzzle is served (that's keyed off the
 * date string itself via getDailyPuzzleIndex, independent of this constant).
 * Update to the real launch date before shipping.
 */
export const DAILY_EPOCH = '2026-01-01'

/** 1-indexed "Daily #N" for the share card. Not used for puzzle selection. */
export function getDailyNumber(dateString: string): number {
  return daysBetween(DAILY_EPOCH, dateString) + 1
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test daily.test.ts`
Expected: PASS.

- [ ] **Step 5: Export from the engine barrel**

In `src/engine/index.ts`, change:

```ts
export { hashDateString, getDailyPuzzleIndex } from './daily'
```

to:

```ts
export { hashDateString, getDailyPuzzleIndex, getDailyNumber, DAILY_EPOCH } from './daily'
```

- [ ] **Step 6: Run the full engine test suite**

Run: `pnpm test src/engine`
Expected: PASS (check `src/engine/index.test.ts` for any barrel-export completeness assertions that might need the new names added).

- [ ] **Step 7: Commit**

```bash
git add src/engine/daily.ts src/engine/daily.test.ts src/engine/index.ts
git commit -m "Add getDailyNumber for the Daily share card's day count"
```

---

### Task 5: Move the streak off Practice — Daily-only activity from here on

**Files:**

- Modify: `src/app/practice/usePracticeSession.ts`
- Modify: `src/app/practice/usePracticeSession.test.ts`

**Interfaces:**

- Produces: `usePracticeSession`'s `handleAnswered` no longer calls `recordActivity` — `profile.streak` passes through a Practice attempt completely unchanged.

This is the streak-semantics change called out as high-risk in the brief: get it wrong and Practice attempts either keep advancing the streak (Daily-only never actually lands) or corrupt existing users' streak state on the next attempt. The fix is a pure subtraction — delete two lines, change one — verified by a new regression test.

- [ ] **Step 1: Write the failing test**

Add to `src/app/practice/usePracticeSession.test.ts`, inside `describe('usePracticeSession', ...)`:

```ts
it('does not change the streak on a practice attempt (Daily-only anchors the streak)', async () => {
  const { result } = renderHook(() => usePracticeSession())
  await waitFor(() => {
    expect(result.current.status).toBe('ready')
  })

  const streakBefore = result.current.profile?.streak
  expect(streakBefore).toEqual({ currentStreak: 0, longestStreak: 0, lastActiveDate: null })

  act(() => {
    result.current.handleAnswered({ correct: true, choiceIndex: 0 })
  })

  expect(result.current.profile?.streak).toEqual(streakBefore)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test usePracticeSession.test.ts`
Expected: FAIL — `recordActivity` currently bumps `currentStreak`/`lastActiveDate` on any attempt, so the streak after `handleAnswered` differs from `streakBefore`.

- [ ] **Step 3: Remove the streak call from Practice's commit flow**

In `src/app/practice/usePracticeSession.ts`:

Remove `recordActivity` from the barrel import:

```ts
import {
  recordMiss,
  roundForDisplay,
  selectNext,
  shouldRateAttempt,
  updateRating,
} from '../../engine'
```

In `handleAnswered`, remove this line:

```ts
const newStreak = recordActivity(profile.streak, today)
```

And in the `updatedProfile` object, remove the `streak: newStreak,` line entirely (the `...profile` spread already carries the existing, now-untouched `streak` forward):

```ts
const updatedProfile: UserProfile = {
  ...profile,
  rating: newRating,
  ratedAttemptCount: profile.ratedAttemptCount + 1,
  requeueState: newRequeueState,
}
```

`today` (`todayDateString()`) stays — it's still used for `attempt.localDateString`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test usePracticeSession.test.ts`
Expected: PASS (all existing tests too — none of them assert on streak behavior).

- [ ] **Step 5: Commit**

```bash
git add src/app/practice/usePracticeSession.ts src/app/practice/usePracticeSession.test.ts
git commit -m "Stop Practice attempts from advancing the streak (Daily-only, per build plan)"
```

---

### Task 6: Share-text formatter (pure function)

**Files:**

- Create: `src/app/daily/shareText.ts`
- Create: `src/app/daily/shareText.test.ts`

**Interfaces:**

- Produces: `buildShareText(input: ShareTextInput): string`, `ShareTextInput { dayNumber: number; correct: boolean; streak: number }`.

_(Delegatable to a fast/cheap subagent at execution time — fully specified below, no ambiguity left.)_

- [ ] **Step 1: Write the failing tests**

Create `src/app/daily/shareText.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildShareText } from './shareText'

describe('buildShareText', () => {
  it('matches the exact Wordle-style format from the build plan (first-try success)', () => {
    const text = buildShareText({ dayNumber: 37, correct: true, streak: 12 })
    expect(text).toBe('Codoro Daily #37 — ✅ first try — 🔥 12-day streak — getcodoro.com')
  })

  it('renders a missed first attempt with a distinct icon/copy, still no spoilers', () => {
    const text = buildShareText({ dayNumber: 5, correct: false, streak: 1 })
    expect(text).toBe('Codoro Daily #5 — ❌ missed it — 🔥 1-day streak — getcodoro.com')
  })

  it('renders a zero streak correctly (first-ever Daily completion)', () => {
    const text = buildShareText({ dayNumber: 1, correct: true, streak: 0 })
    expect(text).toBe('Codoro Daily #1 — ✅ first try — 🔥 0-day streak — getcodoro.com')
  })

  it('never includes puzzle-specific content (prompt/explanation) — no spoilers by construction', () => {
    const text = buildShareText({ dayNumber: 37, correct: true, streak: 12 })
    expect(text).not.toMatch(/explanation|prompt|snippet/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test shareText.test.ts`
Expected: FAIL — `src/app/daily/shareText.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/app/daily/shareText.ts`:

```ts
/**
 * Wordle-style clipboard share text for a completed Daily puzzle. Pure
 * formatting only — puzzle content (prompt/explanation/snippet) never enters
 * this function, so "no spoilers" holds by construction, not by convention.
 * Treat this format as a public API once shipped — the build plan expects
 * users to screenshot it.
 */
export interface ShareTextInput {
  dayNumber: number
  /** Whether the day's rated (first) attempt was correct — retries never change this, see useDailySession. */
  correct: boolean
  streak: number
}

const SITE_URL = 'getcodoro.com'

export function buildShareText({ dayNumber, correct, streak }: ShareTextInput): string {
  const resultLine = correct ? '✅ first try' : '❌ missed it'
  return `Codoro Daily #${String(dayNumber)} — ${resultLine} — 🔥 ${String(streak)}-day streak — ${SITE_URL}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test shareText.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/daily/shareText.ts src/app/daily/shareText.test.ts
git commit -m "Add Daily share-text formatter"
```

---

### Task 7: `useDailySession` — the Daily orchestration hook

**Files:**

- Create: `src/app/daily/useDailySession.ts`
- Create: `src/app/daily/useDailySession.test.ts`

**Interfaces:**

- Consumes: `getDailyNumber`, `getDailyPuzzleIndex`, `recordActivity`, `roundForDisplay`, `shouldRateAttempt`, `updateRating` (all from `../../engine`); `appendAttempt`, `loadProfile`, `saveProfile` (from `../../storage`); `puzzlePool` (from `../../content`); `trackAttempt`, `trackError` (from `../../telemetry`); `CommitPayload` (from `../practice/interactionTypes`).
- Produces: `DailySession` interface consumed by Task 8's `DailyPage`: `{ status, profile, puzzle, dayNumber, completedToday, ratingDelta, attemptNonce, handleAnswered, handleRetry, retryLoad }`.

This is the highest-risk task alongside Task 5 — it's the only place `dailyCompletion` is written, and a bug here either lets a retry silently re-rate (corrupting `rating`/`ratedAttemptCount`) or blocks the legitimate first attempt of a new day from rating at all.

- [ ] **Step 1: Write the failing tests**

Create `src/app/daily/useDailySession.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { updateRating, roundForDisplay, getDailyNumber, getDailyPuzzleIndex } from '../../engine'
import type { Puzzle } from '../../content'
import { useDailySession } from './useDailySession'

const { FIXTURE_POOL } = vi.hoisted(() => ({
  FIXTURE_POOL: Array.from({ length: 12 }, (_, i) => ({
    id: `p${String(i)}`,
    pattern: i % 2 === 0 ? 'off-by-one' : 'null-undefined',
    difficulty_rating: 1150 + i * 10,
    explanation: `explanation ${String(i)}`,
    prompt: `prompt ${String(i)}`,
    language: 'javascript',
    snippet: 'const x = 1',
    interaction: 'mcq',
    choices: ['a', 'b'],
    correct_choice: 0,
  })) as unknown as Puzzle[],
}))

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return { ...actual, puzzlePool: FIXTURE_POOL }
})

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return {
    ...actual,
    loadProfile: vi.fn(),
    saveProfile: vi.fn(),
    appendAttempt: vi.fn(),
    listAttempts: vi.fn(),
  }
})

vi.mock('../../telemetry', () => ({ trackAttempt: vi.fn(), trackError: vi.fn() }))

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')

function today(): string {
  const d = new Date()
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function expectedPuzzle(): Puzzle {
  const index = getDailyPuzzleIndex(today(), FIXTURE_POOL.length)
  return FIXTURE_POOL[index]
}

describe('useDailySession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("resolves today's puzzle via the deterministic date hash and the correct day number", async () => {
    const { result } = renderHook(() => useDailySession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    expect(result.current.puzzle?.id).toBe(expectedPuzzle().id)
    expect(result.current.dayNumber).toBe(getDailyNumber(today()))
    expect(result.current.completedToday).toBe(false)
  })

  it('a first-of-day attempt rates, advances the streak, and sets dailyCompletion', async () => {
    const { result } = renderHook(() => useDailySession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const puzzle = expectedPuzzle()
    const before = result.current.profile
    if (!before) throw new Error('expected a profile to be loaded')

    const expectedNewRating = updateRating(
      before.rating,
      puzzle.difficulty_rating,
      true,
      before.ratedAttemptCount,
    )
    const expectedDelta = roundForDisplay(expectedNewRating) - roundForDisplay(before.rating)

    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })

    expect(result.current.ratingDelta).toBe(expectedDelta)
    expect(result.current.profile?.rating).toBe(expectedNewRating)
    expect(result.current.profile?.ratedAttemptCount).toBe(1)
    expect(result.current.profile?.streak.currentStreak).toBe(1)
    expect(result.current.profile?.dailyCompletion?.date).toBe(today())
    expect(result.current.profile?.dailyCompletion?.correct).toBe(true)
    expect(result.current.completedToday).toBe(true)

    expect(saveProfile).toHaveBeenCalledTimes(1)
    expect(appendAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'daily', correct: true, userRatingAfter: expectedNewRating }),
    )
  })

  it('a same-day retry after completion does not rate, does not touch the streak, and does not overwrite dailyCompletion', async () => {
    const { result } = renderHook(() => useDailySession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })
    const afterFirst = result.current.profile
    if (!afterFirst) throw new Error('expected a profile after the first attempt')

    act(() => {
      result.current.handleRetry()
    })
    act(() => {
      // Retry answered incorrectly this time — must not flip dailyCompletion.correct.
      result.current.handleAnswered({ correct: false, choiceIndex: 1 })
    })

    expect(result.current.ratingDelta).toBeNull()
    expect(result.current.profile?.rating).toBe(afterFirst.rating)
    expect(result.current.profile?.ratedAttemptCount).toBe(afterFirst.ratedAttemptCount)
    expect(result.current.profile?.streak).toEqual(afterFirst.streak)
    expect(result.current.profile?.dailyCompletion).toEqual(afterFirst.dailyCompletion)

    // Both attempts still get appended for telemetry/history purposes.
    expect(appendAttempt).toHaveBeenCalledTimes(2)
    expect(appendAttempt).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'daily', correct: false }),
    )
  })

  it('a new calendar day (stale dailyCompletion date) is treated as first-of-day again', async () => {
    const staleProfile = {
      ...createDefaultProfile(),
      dailyCompletion: { date: '2000-01-01', attemptId: 'old', correct: true },
    }
    vi.mocked(loadProfile).mockResolvedValue(staleProfile)

    const { result } = renderHook(() => useDailySession())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.completedToday).toBe(false)

    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })

    expect(result.current.ratingDelta).not.toBeNull()
    expect(result.current.profile?.dailyCompletion?.date).toBe(today())
    expect(result.current.profile?.ratedAttemptCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test useDailySession.test.ts`
Expected: FAIL — `src/app/daily/useDailySession.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/app/daily/useDailySession.ts`:

```ts
/**
 * Orchestrates the Daily loop: resolves today's puzzle via engine's
 * deterministic date hash (one puzzle per calendar date, same shape for
 * every user on this bundle), loads/persists the profile, and wires the
 * answer through rating/streak/storage/telemetry. Mirrors
 * usePracticeSession's shape but for a single fixed puzzle rather than
 * selection/requeue.
 *
 * Only the first attempt of a calendar day is rated and advances the streak
 * (Daily anchors the streak now, not Practice — see
 * usePracticeSession.ts's removed recordActivity call). Further attempts the
 * same day are recorded (mode: 'daily' Attempts still get appended) but
 * never touch rating, ratedAttemptCount, streak, or dailyCompletion — "no
 * re-taking for a better share" per the build plan.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getDailyNumber,
  getDailyPuzzleIndex,
  recordActivity,
  roundForDisplay,
  shouldRateAttempt,
  updateRating,
} from '../../engine'
import { appendAttempt, loadProfile, saveProfile } from '../../storage'
import type { Attempt, UserProfile } from '../../storage'
import { puzzlePool } from '../../content'
import type { Puzzle as ContentPuzzle } from '../../content'
import { trackAttempt, trackError } from '../../telemetry'
import type { CommitPayload } from '../practice/interactionTypes'

/** Local calendar-date string (YYYY-MM-DD) from wall-clock time — never a date library, matching usePracticeSession's convention. */
function todayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

export type DailySessionStatus = 'loading' | 'ready' | 'empty' | 'error'

export interface DailySession {
  status: DailySessionStatus
  profile: UserProfile | null
  puzzle: ContentPuzzle | null
  dayNumber: number
  /** True once today's puzzle has a recorded first (rated) attempt — drives the ShareCard. */
  completedToday: boolean
  /** Rating delta for the most recent attempt; null for an unrated retry. */
  ratingDelta: number | null
  /** Bumped by handleRetry to force PuzzleCardShell to remount for another (unrated) attempt at the same puzzle. */
  attemptNonce: number
  handleAnswered: (payload: CommitPayload) => void
  handleRetry: () => void
  retryLoad: () => void
}

export function useDailySession(): DailySession {
  const [status, setStatus] = useState<DailySessionStatus>('loading')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [ratingDelta, setRatingDelta] = useState<number | null>(null)
  const [attemptNonce, setAttemptNonce] = useState(0)

  const today = todayDateString()
  const dayNumber = getDailyNumber(today)
  const puzzle: ContentPuzzle | null =
    puzzlePool.length > 0 ? puzzlePool[getDailyPuzzleIndex(today, puzzlePool.length)] : null

  const servedAtRef = useRef<number>(Date.now())
  const cancelledRef = useRef(false)

  const load = useCallback(() => {
    if (puzzle === null) {
      setStatus('empty')
      return
    }
    cancelledRef.current = false
    void (async () => {
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        setProfile(loaded)
        servedAtRef.current = Date.now()
        setStatus('ready')
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useDailySession: loadProfile failed on mount')
        setStatus('error')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load()
    return () => {
      cancelledRef.current = true
    }
    // Mount-only, same convention as usePracticeSession.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retryLoad = useCallback(() => {
    setStatus('loading')
    load()
  }, [load])

  const handleAnswered = useCallback(
    (payload: CommitPayload) => {
      if (!profile || !puzzle) return

      const timeMs = Math.max(0, Date.now() - servedAtRef.current)
      const isFirstAttemptOfDay =
        profile.dailyCompletion === null || profile.dailyCompletion.date !== today
      const rates = shouldRateAttempt('daily', isFirstAttemptOfDay)

      const oldRating = profile.rating
      const newRating = rates
        ? updateRating(
            oldRating,
            puzzle.difficulty_rating,
            payload.correct,
            profile.ratedAttemptCount,
          )
        : oldRating
      const delta = rates ? roundForDisplay(newRating) - roundForDisplay(oldRating) : null

      const attemptId = crypto.randomUUID()
      const newStreak = isFirstAttemptOfDay ? recordActivity(profile.streak, today) : profile.streak
      const newDailyCompletion = isFirstAttemptOfDay
        ? { date: today, attemptId, correct: payload.correct }
        : profile.dailyCompletion

      const updatedProfile: UserProfile = {
        ...profile,
        rating: newRating,
        ratedAttemptCount: rates ? profile.ratedAttemptCount + 1 : profile.ratedAttemptCount,
        streak: newStreak,
        dailyCompletion: newDailyCompletion,
      }

      const attempt: Attempt = {
        id: attemptId,
        puzzleId: puzzle.id,
        puzzleRating: puzzle.difficulty_rating,
        mode: 'daily',
        correct: payload.correct,
        time_ms: timeMs,
        choice_index: payload.choiceIndex,
        userRatingBefore: oldRating,
        userRatingAfter: newRating,
        localDateString: today,
        createdAt: new Date().toISOString(),
      }

      setProfile(updatedProfile)
      setRatingDelta(delta)

      appendAttempt(attempt).catch((error: unknown) => {
        trackError(error, 'useDailySession: appendAttempt failed')
      })
      saveProfile(updatedProfile).catch((error: unknown) => {
        trackError(error, 'useDailySession: saveProfile failed')
      })

      trackAttempt({
        puzzle_id: puzzle.id,
        correct: payload.correct,
        time_ms: timeMs,
        mode: 'daily',
        interaction: puzzle.interaction,
        user_rating_before: oldRating,
        user_rating_after: newRating,
      })
    },
    [profile, puzzle, today],
  )

  const handleRetry = useCallback(() => {
    servedAtRef.current = Date.now()
    setRatingDelta(null)
    setAttemptNonce((n) => n + 1)
  }, [])

  return {
    status,
    profile,
    puzzle,
    dayNumber,
    completedToday: profile?.dailyCompletion?.date === today,
    ratingDelta,
    attemptNonce,
    handleAnswered,
    handleRetry,
    retryLoad,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test useDailySession.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/daily/useDailySession.ts src/app/daily/useDailySession.test.ts
git commit -m "Add useDailySession: rated-first-attempt, unrated-retry Daily orchestration"
```

---

### Task 8: `ShareCard` and `DailyPage`

**Files:**

- Create: `src/app/daily/ShareCard.tsx`
- Create: `src/app/daily/DailyPage.tsx`
- Create: `src/app/daily/dailyPage.css`
- Create: `src/app/daily/DailyPage.test.tsx`
- Modify: `src/test/setup.ts` (stub `navigator.clipboard`, jsdom doesn't implement it)

**Interfaces:**

- Consumes: `useDailySession` (Task 7), `buildShareText` (Task 6), `PuzzleCardShell` (existing, unmodified — reused as-is).
- Produces: `<DailyPage />`, consumed by Task 9's `App.tsx`.

- [ ] **Step 1: Stub `navigator.clipboard` in the shared test setup**

In `src/test/setup.ts`, add after the existing `window.matchMedia` stub:

```ts
// jsdom doesn't implement navigator.clipboard — ShareCard (Daily mode) calls
// writeText on copy. Stubbed as a resolving no-op, same pattern as the
// pointer-capture/scrollTo/matchMedia stubs above; tests that assert the
// copy behavior spy on this via vi.spyOn(navigator.clipboard, 'writeText').
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: () => Promise.resolve() },
  writable: true,
  configurable: true,
})
```

- [ ] **Step 2: Write the failing component test**

Create `src/app/daily/DailyPage.test.tsx`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Puzzle } from '../../content'

const { FIXTURE_POOL } = vi.hoisted(() => ({
  FIXTURE_POOL: Array.from({ length: 12 }, (_, i) => ({
    id: `p${String(i)}`,
    pattern: i % 2 === 0 ? 'off-by-one' : 'null-undefined',
    difficulty_rating: 1150 + i * 10,
    explanation: `explanation ${String(i)}`,
    prompt: `prompt ${String(i)}`,
    language: 'javascript',
    snippet: 'const x = 1',
    interaction: 'mcq',
    choices: ['a', 'b'],
    correct_choice: 0,
  })) as unknown as Puzzle[],
}))

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return { ...actual, puzzlePool: FIXTURE_POOL }
})

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return {
    ...actual,
    loadProfile: vi.fn(),
    saveProfile: vi.fn(),
    appendAttempt: vi.fn(),
    listAttempts: vi.fn(),
  }
})

vi.mock('../../telemetry', () => ({ trackAttempt: vi.fn(), trackError: vi.fn() }))

const { loadProfile, saveProfile, appendAttempt, createDefaultProfile } =
  await import('../../storage')
const { DailyPage } = await import('./DailyPage')

describe('DailyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
  })

  it("renders today's puzzle without a share card before any attempt", async () => {
    render(<DailyPage />)

    await waitFor(() => {
      expect(screen.getByText(/Codoro Daily #/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Copy share text/i)).not.toBeInTheDocument()
  })

  it('reveals the share card after the first attempt, with a working copy button', async () => {
    const user = userEvent.setup()
    render(<DailyPage />)

    await waitFor(() => {
      expect(screen.getByText(/Codoro Daily #/)).toBeInTheDocument()
    })

    const choiceButtons = screen.getAllByRole('button', { name: /^[ab]$/i })
    await user.click(choiceButtons[0])

    await waitFor(() => {
      expect(screen.getByText(/Copy share text/i)).toBeInTheDocument()
    })

    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    await user.click(screen.getByText(/Copy share text/i))

    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('Codoro Daily #'))
    await waitFor(() => {
      expect(screen.getByText(/Copied!/i)).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test DailyPage.test.tsx`
Expected: FAIL — `src/app/daily/DailyPage.tsx` doesn't exist yet.

- [ ] **Step 4: Implement `ShareCard.tsx`**

Create `src/app/daily/ShareCard.tsx`:

```tsx
/**
 * The Wordle-style clipboard share card, shown once today's Daily puzzle has
 * a recorded first attempt (see DailyPage). "Copied!" is local, ungated UI
 * feedback — no telemetry event for the copy action itself in this phase.
 */
import { useState } from 'react'
import { buildShareText } from './shareText'
import './dailyPage.css'

export interface ShareCardProps {
  dayNumber: number
  correct: boolean
  streak: number
}

export function ShareCard({ dayNumber, correct, streak }: ShareCardProps) {
  const [copied, setCopied] = useState(false)
  const text = buildShareText({ dayNumber, correct, streak })

  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
    })
  }

  return (
    <div className="share-card">
      <p className="share-card__text">{text}</p>
      <button type="button" className="share-card__button" onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy share text'}
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Implement `dailyPage.css`**

Create `src/app/daily/dailyPage.css`:

```css
/*
 * Daily-page-level chrome: page layout, heading, and the share card.
 * Same design-system rules as practicePage.css: no box-shadow anywhere,
 * mobile-first, >=44px tap targets.
 */

.daily-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  padding: calc(1rem + env(safe-area-inset-top)) 1rem 1rem;
  box-sizing: border-box;
}

.daily-page__status {
  text-align: center;
  color: var(--text-muted);
  padding: 2rem 0;
}

.daily-page__link {
  min-height: 44px;
  padding: 0.5rem 0.75rem;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
}

.daily-page__heading {
  margin: 0;
  text-align: center;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
}

.share-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.875rem 1rem;
  border-radius: 0.75rem;
  background: var(--surface-card);
  border: 1px solid var(--border-subtle);
}

.share-card__text {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.share-card__button {
  min-height: 44px;
  border: none;
  border-radius: 0.5rem;
  background: var(--primary-action-bg);
  border-bottom: 3px solid var(--primary-action-border);
  color: var(--primary-action-text);
  font-weight: 700;
  cursor: pointer;
}
```

- [ ] **Step 6: Implement `DailyPage.tsx`**

Create `src/app/daily/DailyPage.tsx`:

```tsx
/**
 * Daily mode: one puzzle per calendar date (engine's deterministic date
 * hash), first attempt rated, further attempts unrated retries via the same
 * PuzzleCardShell (see useDailySession's doc comment). Once today's puzzle
 * has a recorded first attempt, the share card stays visible alongside the
 * card so retries never hide or change the shareable result — "no re-taking
 * for a better share" per the build plan.
 */
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { useDailySession } from './useDailySession'
import { ShareCard } from './ShareCard'
import './dailyPage.css'

export function DailyPage() {
  const session = useDailySession()

  if (session.status === 'error') {
    return (
      <div className="daily-page">
        <p className="daily-page__status">
          We couldn&apos;t load today&apos;s puzzle. Please try again.
        </p>
        <button type="button" className="daily-page__link" onClick={session.retryLoad}>
          Try again
        </button>
      </div>
    )
  }

  if (session.status === 'loading' || session.profile === null) {
    return (
      <div className="daily-page">
        <p className="daily-page__status">Loading today&apos;s puzzle…</p>
      </div>
    )
  }

  if (session.status === 'empty' || session.puzzle === null) {
    return (
      <div className="daily-page">
        <p className="daily-page__status">No daily puzzle available right now.</p>
      </div>
    )
  }

  return (
    <div className="daily-page">
      <p className="daily-page__heading">Codoro Daily #{session.dayNumber}</p>

      {session.completedToday && (
        <ShareCard
          dayNumber={session.dayNumber}
          correct={session.profile.dailyCompletion?.correct ?? false}
          streak={session.profile.streak.currentStreak}
        />
      )}

      <PuzzleCardShell
        key={`${session.puzzle.id}-${String(session.attemptNonce)}`}
        puzzle={session.puzzle}
        ratingDelta={session.ratingDelta}
        onAnswered={session.handleAnswered}
        onContinue={session.handleRetry}
      />
    </div>
  )
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test DailyPage.test.tsx`
Expected: PASS.

- [ ] **Step 8: Run the full test suite (regression check for the setup.ts change)**

Run: `pnpm test`
Expected: PASS — the `navigator.clipboard` stub must not break any existing test.

- [ ] **Step 9: Commit**

```bash
git add src/app/daily/ShareCard.tsx src/app/daily/DailyPage.tsx src/app/daily/dailyPage.css src/app/daily/DailyPage.test.tsx src/test/setup.ts
git commit -m "Add DailyPage and ShareCard"
```

---

### Task 9: Minimal mode switcher, wired into `App.tsx`

**Files:**

- Create: `src/app/ModeSwitcher.tsx`
- Create: `src/app/app.css`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

**Interfaces:**

- Produces: `AppMode = 'practice' | 'daily'`, `<ModeSwitcher mode={AppMode} onChange={(mode: AppMode) => void} />`.

_(Delegatable to a fast/cheap subagent at execution time — fully specified below.)_

Default mode is `'practice'` (not `'daily'`) — a deliberate minimal-scope call to avoid touching `App.test.tsx`'s existing default-render assertion and to avoid needing a Daily-specific rating/streak status bar in this phase. Flag this as an easy one-line flip if Thomas wants Daily to be the landing view instead.

- [ ] **Step 1: Write the failing test**

Add to `src/app/App.test.tsx`, an `import userEvent from '@testing-library/user-event'` line near the top, and a new `it` inside `describe('App', ...)` (after the existing test):

```ts
  it('defaults to Practice, and switches to the Daily UI via the mode switcher', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Daily' }))

    await waitFor(() => {
      expect(screen.getByText(/Codoro Daily #/)).toBeInTheDocument()
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test App.test.tsx`
Expected: FAIL — no "Daily" button exists yet, `App.tsx` renders only `PracticePage`.

- [ ] **Step 3: Implement `ModeSwitcher.tsx`**

Create `src/app/ModeSwitcher.tsx`:

```tsx
/**
 * Minimal two-tab switcher between Practice and Daily — no routing library,
 * per the build plan's "keep it minimal" instruction for reaching a second
 * screen. Plain-text tabs, same no-icon-library convention as StatusBar's
 * pills.
 */
import './app.css'

export type AppMode = 'practice' | 'daily'

export interface ModeSwitcherProps {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

export function ModeSwitcher({ mode, onChange }: ModeSwitcherProps) {
  return (
    <nav className="mode-switcher" aria-label="Mode">
      <button
        type="button"
        className={`mode-switcher__tab${mode === 'practice' ? ' mode-switcher__tab--active' : ''}`}
        aria-pressed={mode === 'practice'}
        onClick={() => {
          onChange('practice')
        }}
      >
        Practice
      </button>
      <button
        type="button"
        className={`mode-switcher__tab${mode === 'daily' ? ' mode-switcher__tab--active' : ''}`}
        aria-pressed={mode === 'daily'}
        onClick={() => {
          onChange('daily')
        }}
      >
        Daily
      </button>
    </nav>
  )
}
```

- [ ] **Step 4: Implement `app.css`**

Create `src/app/app.css`:

```css
/*
 * App-shell-level chrome: the mode switcher. Same design-system rules as
 * practicePage.css/dailyPage.css: no box-shadow anywhere, >=44px tap
 * targets.
 */

.mode-switcher {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  padding: calc(0.5rem + env(safe-area-inset-top)) 1rem 0;
}

.mode-switcher__tab {
  min-height: 44px;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
}

.mode-switcher__tab--active {
  background: var(--surface-card);
  color: var(--text-primary);
}
```

- [ ] **Step 5: Wire it into `App.tsx`**

Replace `src/app/App.tsx`:

```tsx
import { useState } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { PracticePage } from './practice/PracticePage'
import { DailyPage } from './daily/DailyPage'
import { PwaPrompts } from './pwa/PwaPrompts'
import { ModeSwitcher } from './ModeSwitcher'
import type { AppMode } from './ModeSwitcher'

export function App() {
  const [mode, setMode] = useState<AppMode>('practice')

  return (
    <ErrorBoundary>
      <main>
        <ModeSwitcher mode={mode} onChange={setMode} />
        {mode === 'practice' ? <PracticePage /> : <DailyPage />}
      </main>
      <PwaPrompts />
    </ErrorBoundary>
  )
}
```

Note: `PracticePage`/`DailyPage` each still apply their own top `env(safe-area-inset-top)` padding independently, and `ModeSwitcher` now also does — this stacks a little extra top padding above the switcher rather than double-counting incorrectly. Not a functional bug, just worth a glance during review.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test App.test.tsx`
Expected: PASS.

- [ ] **Step 7: Run the full test suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/ModeSwitcher.tsx src/app/app.css src/app/App.tsx src/app/App.test.tsx
git commit -m "Add a minimal Practice/Daily mode switcher"
```

---

### Task 10: OG meta tags in `index.html`

**Files:**

- Modify: `index.html`
- Create: `index.html.test.ts` (repo root — mirrors `PracticePage.test.tsx`'s source-reading-regex convention for asserting on non-TS source)

**Interfaces:** none (static markup + a source-content test).

This task assumes Task 11's `public/og-image.png` will exist at `https://getcodoro.com/og-image.png` once deployed — the meta tag references that path regardless of build order, since it's a static public asset path, not a build-time import.

- [ ] **Step 1: Write the failing test**

Create `index.html.test.ts` at the repo root:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync('index.html', 'utf-8')

describe('index.html OG/Twitter meta tags', () => {
  it('has a well-formed Open Graph tag set for link unfurling', () => {
    expect(html).toMatch(/<meta property="og:type" content="website" \/>/)
    expect(html).toMatch(/<meta property="og:url" content="https:\/\/getcodoro\.com\/" \/>/)
    expect(html).toMatch(/<meta property="og:title" content="[^"]+" \/>/)
    expect(html).toMatch(/<meta property="og:description" content="[^"]+" \/>/)
    expect(html).toMatch(
      /<meta property="og:image" content="https:\/\/getcodoro\.com\/og-image\.png" \/>/,
    )
    expect(html).toMatch(/<meta property="og:image:width" content="1200" \/>/)
    expect(html).toMatch(/<meta property="og:image:height" content="630" \/>/)
  })

  it('has a matching Twitter card tag set', () => {
    expect(html).toMatch(/<meta name="twitter:card" content="summary_large_image" \/>/)
    expect(html).toMatch(/<meta name="twitter:title" content="[^"]+" \/>/)
    expect(html).toMatch(/<meta name="twitter:description" content="[^"]+" \/>/)
    expect(html).toMatch(
      /<meta name="twitter:image" content="https:\/\/getcodoro\.com\/og-image\.png" \/>/,
    )
  })

  it('does not touch the PWA/update-prompt-related tags (out of scope for this phase)', () => {
    expect(html).toMatch(
      /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" \/>/,
    )
    expect(html).toMatch(/viewport-fit=cover/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test index.html.test.ts`
Expected: FAIL — none of the OG/Twitter tags exist yet.

- [ ] **Step 3: Implement**

In `index.html`, add the following inside `<head>`, right after the existing `<meta name="apple-mobile-web-app-title" content="Codoro" />` line and before `<title>`:

```html
<!-- Open Graph / Twitter unfurl tags — see public/og-image.png (generated by
         src/app/og/generateOgImage.ts). Domain is getcodoro.com per the build plan. -->
<meta property="og:type" content="website" />
<meta property="og:url" content="https://getcodoro.com/" />
<meta property="og:title" content="Codoro — Daily coding puzzles" />
<meta
  property="og:description"
  content="A new bug-spotting puzzle every day, calibrated to your rating. Keep your streak alive."
/>
<meta property="og:image" content="https://getcodoro.com/og-image.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Codoro — Daily coding puzzles" />
<meta
  name="twitter:description"
  content="A new bug-spotting puzzle every day, calibrated to your rating. Keep your streak alive."
/>
<meta name="twitter:image" content="https://getcodoro.com/og-image.png" />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test index.html.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html index.html.test.ts
git commit -m "Add OG/Twitter meta tags so shared links unfurl"
```

---

### Task 11: Generate the OG image asset

**Files:**

- Create: `src/app/og/generateOgImage.ts`
- Modify: `package.json` (add `generate:og-image` script)
- Create (generated, then committed): `public/og-image.png`

**Interfaces:** none (build-time script, not imported by app code — mirrors `src/app/pwa/generatePwaIcons.ts`'s convention exactly).

_(Delegatable to a fast/cheap subagent at execution time — fully specified below. This produces a real 1200×630 landscape composition, not a stretched square icon, per the brief's explicit warning against that.)_

- [ ] **Step 1: Add the package.json script**

In `package.json`, add a new line after `"generate:pwa-icons": "tsx src/app/pwa/generatePwaIcons.ts",`:

```json
    "generate:og-image": "tsx src/app/og/generateOgImage.ts",
```

- [ ] **Step 2: Implement the generator script**

Create `src/app/og/generateOgImage.ts`:

```ts
/**
 * One-off dev script: rasterizes public/favicon.svg's logomark onto a
 * 1200x630 brand-purple canvas for index.html's og:image/twitter:image. Not
 * imported by app code — run manually via `pnpm generate:og-image` whenever
 * the logomark or brand color changes. Mirrors generatePwaIcons.ts's
 * structure and its rasterizeLogo seam-crop workaround exactly (same
 * resvg/sharp SVG-rasterization quirk applies here).
 *
 * Deliberately no baked-in text: og:title/og:description already carry the
 * copy, and every unfurl client renders those as real text over the image —
 * baking text into the raster via sharp/resvg would depend on fonts being
 * installed in whatever environment runs this script, which isn't
 * guaranteed. The image's job is just the brand mark on brand color, at the
 * ~1200x630 landscape shape Discord/iMessage/Slack expect.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

const BRAND_PURPLE = '#863bff'
const SOURCE_SVG = resolve(import.meta.dirname, '../../../public/favicon.svg')
const OUT_FILE = resolve(import.meta.dirname, '../../../public/og-image.png')

const WIDTH = 1200
const HEIGHT = 630
const LOGO_SIZE = 260

async function rasterizeLogo(svg: Buffer, size: number): Promise<Buffer> {
  const raw = await sharp(svg).resize(size, size, { fit: 'contain' }).png().toBuffer()
  const seamMargin = Math.max(2, Math.round(size * 0.03))
  const cropped = await sharp(raw)
    .extract({ left: 0, top: seamMargin, width: size, height: size - seamMargin * 2 })
    .toBuffer()
  return sharp(cropped)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

async function main(): Promise<void> {
  const svg = readFileSync(SOURCE_SVG)
  const logo = await rasterizeLogo(svg, LOGO_SIZE)
  const left = Math.round((WIDTH - LOGO_SIZE) / 2)
  const top = Math.round((HEIGHT - LOGO_SIZE) / 2)

  await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: BRAND_PURPLE,
    },
  })
    .composite([{ input: logo, top, left }])
    .png()
    .toFile(OUT_FILE)

  console.log(`Generated ${OUT_FILE} (${String(WIDTH)}x${String(HEIGHT)}) from ${SOURCE_SVG}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
```

- [ ] **Step 3: Run it and verify the output**

Run: `pnpm generate:og-image`
Expected: `public/og-image.png` is created.

Run: `node -e "require('sharp')('public/og-image.png').metadata().then(m=>console.log(m.width, m.height))"`
Expected output: `1200 630`

- [ ] **Step 4: Commit**

```bash
git add src/app/og/generateOgImage.ts package.json public/og-image.png
git commit -m "Generate the OG/Twitter unfurl image"
```

---

### Task 12: Final validation and PR

**Files:** none (verification only).

- [ ] **Step 1: Run the full validation pipeline**

Run: `pnpm validate`
Expected: `typecheck`, `lint`, `test`, `validate:content`, and `build` all pass with no errors.

- [ ] **Step 2: Confirm the storage coverage threshold still holds**

`vite.config.ts` requires 100% statements/functions/lines and 96% branches for `src/engine/**` and `src/storage/**`. Run: `pnpm test:coverage`
Expected: PASS. If `src/storage/migrations.ts`'s new `migrateV1ToV2` or `src/engine/daily.ts`'s new `getDailyNumber` show uncovered branches, add the missing test case(s) from Tasks 2/4 rather than lowering the threshold.

- [ ] **Step 3: Manually sanity-check the OG tags are well-formed**

Open `index.html` and confirm the rendered `og:image` URL (`https://getcodoro.com/og-image.png`) will actually resolve once deployed (i.e., `public/og-image.png` exists in the repo from Task 11). The live Discord/iMessage/Slack unfurl itself is explicitly on Thomas per the brief.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin phase-6-daily
gh pr create --title "Phase 6: Daily Puzzle" --body "$(cat <<'EOF'
## Summary
- Daily flow: today's puzzle via the deterministic date hash, first attempt rated, unrated retries, completion state persists for the day.
- Streak wiring moved fully off Practice onto Daily's first-attempt-of-day commit (schema v1 -> v2 migration adds dailyCompletion).
- Wordle-style clipboard share card.
- OG/Twitter meta tags + a generated 1200x630 unfurl image.

## Test plan
- [ ] pnpm validate green
- [ ] Manually confirm public/og-image.png renders correctly at full size
- [ ] Thomas: paste a real share into Discord/iMessage/Slack to confirm the unfurl
- [ ] Thomas: shift device clock forward a day, confirm new puzzle + streak increment; forward two days, confirm streak reset
- [ ] Thomas: complete the Daily on two real devices, confirm identical puzzle
EOF
)"
```

---

## Known launch-readiness gap (do not silently close)

`puzzlePool` is sorted by file path and aggregated at build time. `getDailyPuzzleIndex` hashes a date string mod pool size, computed fresh on every render inside `useDailySession` — stable _within_ one deployed bundle, but if Phase 8's content authoring changes pool size (or sort order) between deploys, two users on different bundle versions on the same calendar date can see different "today's puzzle." The update-prompt mechanism that would otherwise keep everyone on a consistent bundle is the thing already flagged as unreliable — this plan does not attempt to fix that. Report this gap explicitly rather than checking off "same date → same puzzle across devices" as fully closed.

## "Needs Thomas" checklist (restate in the final summary)

- Paste a real share into Discord/iMessage/Slack to confirm the unfurl actually renders.
- Shift device clock forward a day: confirm new puzzle + streak increment. Forward two days: confirm streak reset.
- Complete the Daily on two real devices, confirm identical puzzle.
- Confirm whether `DAILY_EPOCH = '2026-01-01'` (Task 4) should be the real launch date instead — it's a one-line change in `src/engine/daily.ts`.
- Confirm whether `App`'s default mode should be `'daily'` instead of `'practice'` (Task 9) — Daily is the retention/virality anchor per the build plan, but this plan defaults to Practice to minimize scope/risk this phase.
- The `Co-authored-by: Thomas <codoroapp@gmail.com>` trailer on recent merged PRs: confirmed mechanical, not an AI-attribution issue — local commits are authored as `Thomas <codoroapp@gmail.com>` (per `.git/config`), and GitHub's squash-merge auto-appends the original commit author as a `Co-authored-by` trailer whenever the merging account's identity (`tshore2004`'s GitHub noreply email) differs from it. Deliberate or not is Thomas's call; it isn't something this plan's commits caused or can fix from the git-client side.
