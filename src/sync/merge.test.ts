import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { merge } from './merge'
import type { MergeOutcome } from './merge'
import { CURRENT_SCHEMA_VERSION, createDefaultProfile } from '../storage'
import type { Attempt, ExportedData, UserProfile } from '../storage'
import { INITIAL_RATING, updateRating } from '../engine'

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadFixture(name: string): ExportedData {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf-8')) as ExportedData
}

const freshInstall = loadFixture('fresh-install')
const longLived = loadFixture('long-lived')
const postMission = loadFixture('post-mission')
const ALL_FIXTURES = [freshInstall, longLived, postMission] as const

function expectMerged(outcome: MergeOutcome): ExportedData {
  if (outcome.kind !== 'merged') {
    throw new Error(`expected a merged outcome, got ${outcome.kind}`)
  }
  return outcome.data
}

function makeAttempt(overrides: Partial<Attempt>): Attempt {
  return {
    id: crypto.randomUUID(),
    puzzleId: 'p-1',
    puzzleRating: 1200,
    mode: 'practice',
    correct: true,
    time_ms: 1000,
    choice_index: 0,
    checkpoint_results: null,
    userRatingBefore: 1200,
    userRatingAfter: 1200,
    localDateString: '2026-09-12',
    createdAt: '2026-09-12T00:00:00.000Z',
    ...overrides,
  }
}

function makeExport(overrides: Partial<ExportedData>): ExportedData {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    exportedAt: '2026-09-12T00:00:00.000Z',
    profile: createDefaultProfile(),
    attempts: [],
    ...overrides,
  }
}

describe('merge — schema skew', () => {
  it('merges normally when remote is at CURRENT_SCHEMA_VERSION', () => {
    const outcome = merge(freshInstall, longLived)
    expect(outcome.kind).toBe('merged')
  })

  it('migrates a behind-schema remote through runMigrations before merging (v12 -> v13)', () => {
    // v12 -> v13's real migration (migrateV12ToV13) stamps preferences.sound
    // and .autoAdvance to true -- strip them and downgrade the version to
    // prove the actual migrations.ts chain ran, not a sync-specific one.
    const behindProfile: Record<string, unknown> = { ...freshInstall.profile, schema_version: 12 }
    const prefsWithoutNewFields = { ...(behindProfile.preferences as Record<string, unknown>) }
    delete prefsWithoutNewFields.sound
    delete prefsWithoutNewFields.autoAdvance
    behindProfile.preferences = prefsWithoutNewFields

    const remote = makeExport({
      schema_version: 12,
      exportedAt: '2026-09-13T00:00:00.000Z', // later than local, so remote's (migrated) preferences win
      profile: behindProfile as unknown as UserProfile,
    })
    const local = makeExport({ exportedAt: '2026-09-12T00:00:00.000Z' })

    const data = expectMerged(merge(local, remote))
    expect(data.schema_version).toBe(CURRENT_SCHEMA_VERSION)
    expect(data.profile.preferences.sound).toBe(true)
    expect(data.profile.preferences.autoAdvance).toBe(true)
  })

  it('returns a read-only remote-ahead outcome when remote is newer than this build understands, never merging or throwing', () => {
    const remote = makeExport({ schema_version: CURRENT_SCHEMA_VERSION + 1 })
    const outcome = merge(freshInstall, remote)
    expect(outcome).toEqual({
      kind: 'remote-ahead',
      remoteSchemaVersion: CURRENT_SCHEMA_VERSION + 1,
    })
  })
})

describe('merge — attempts union', () => {
  it('unions by id, never dropping an attempt from either side', () => {
    const a = makeExport({
      attempts: [makeAttempt({ id: 'a1', createdAt: '2026-09-10T00:00:00.000Z' })],
    })
    const b = makeExport({
      attempts: [makeAttempt({ id: 'b1', createdAt: '2026-09-11T00:00:00.000Z' })],
    })
    const data = expectMerged(merge(a, b))
    expect(data.attempts.map((x) => x.id).sort()).toEqual(['a1', 'b1'])
  })

  it('re-sorts the union by createdAt, regardless of input order', () => {
    const a = makeExport({
      attempts: [makeAttempt({ id: 'later', createdAt: '2026-09-12T00:00:00.000Z' })],
    })
    const b = makeExport({
      attempts: [makeAttempt({ id: 'earlier', createdAt: '2026-09-10T00:00:00.000Z' })],
    })
    const data = expectMerged(merge(a, b))
    expect(data.attempts.map((x) => x.id)).toEqual(['earlier', 'later'])
  })

  it('a duplicate id (same attempt seen on both sides) is not counted twice', () => {
    const shared = makeAttempt({ id: 'dup' })
    const a = makeExport({ attempts: [shared] })
    const b = makeExport({ attempts: [shared] })
    const data = expectMerged(merge(a, b))
    expect(data.attempts).toHaveLength(1)
  })
})

describe('merge — recompute (F24: attempts union must feed rating/streak, not the other way around)', () => {
  it("recomputes rating/ratedAttemptCount from the merged attempts, not either side's stale field", () => {
    const a = makeExport({
      profile: { ...createDefaultProfile(), rating: 9999, ratedAttemptCount: 9999 },
      attempts: [
        makeAttempt({
          id: 'a1',
          puzzleRating: 1200,
          correct: true,
          createdAt: '2026-09-10T00:00:00.000Z',
        }),
      ],
    })
    const b = makeExport({ attempts: [] })
    const data = expectMerged(merge(a, b))
    const expectedRating = updateRating(INITIAL_RATING, 1200, true, 0)
    expect(data.profile.rating).toBe(expectedRating)
    expect(data.profile.ratedAttemptCount).toBe(1)
  })

  it("a two-device merge recomputes a rating that differs from either device's own single-history recompute (proves the union feeds the recompute, not a partial view)", () => {
    const localOnly = makeExport({
      attempts: [
        makeAttempt({
          id: 'local-1',
          puzzleRating: 1400,
          correct: true,
          createdAt: '2026-09-10T00:00:00.000Z',
        }),
      ],
    })
    const remoteOnly = makeExport({
      attempts: [
        makeAttempt({
          id: 'remote-1',
          puzzleRating: 1000,
          correct: false,
          createdAt: '2026-09-11T00:00:00.000Z',
        }),
      ],
    })
    const localAlone = merge(localOnly, makeExport({ attempts: [] }))
    const remoteAlone = merge(makeExport({ attempts: [] }), remoteOnly)
    const both = expectMerged(merge(localOnly, remoteOnly))

    expect(both.profile.rating).not.toBe(expectMerged(localAlone).profile.rating)
    expect(both.profile.rating).not.toBe(expectMerged(remoteAlone).profile.rating)
    // And it's the correct two-step replay, in chronological order.
    const afterFirst = updateRating(INITIAL_RATING, 1400, true, 0)
    const afterSecond = updateRating(afterFirst, 1000, false, 1)
    expect(both.profile.rating).toBe(afterSecond)
    expect(both.profile.ratedAttemptCount).toBe(2)
  })

  it('rush and boss attempts never rate (shouldRateAttempt), matching the real post-mission fixture', () => {
    const a = makeExport({
      attempts: [
        makeAttempt({
          id: 'r1',
          mode: 'rush',
          correct: true,
          createdAt: '2026-09-10T00:00:00.000Z',
        }),
        makeAttempt({
          id: 'b1',
          mode: 'boss',
          correct: true,
          createdAt: '2026-09-10T00:00:01.000Z',
        }),
      ],
    })
    const data = expectMerged(merge(a, makeExport({ attempts: [] })))
    expect(data.profile.rating).toBe(INITIAL_RATING)
    expect(data.profile.ratedAttemptCount).toBe(0)
  })

  it('only the first daily attempt of a calendar date rates and advances the streak; later same-day daily attempts do neither', () => {
    const first = makeAttempt({
      id: 'd1',
      mode: 'daily',
      correct: true,
      localDateString: '2026-09-10',
      createdAt: '2026-09-10T09:00:00.000Z',
    })
    const second = makeAttempt({
      id: 'd2',
      mode: 'daily',
      correct: false,
      localDateString: '2026-09-10',
      createdAt: '2026-09-10T10:00:00.000Z',
    })
    const data = expectMerged(
      merge(makeExport({ attempts: [first] }), makeExport({ attempts: [second] })),
    )
    expect(data.profile.ratedAttemptCount).toBe(1)
    expect(data.profile.streak.currentStreak).toBe(1)
    expect(data.profile.streak.lastActiveDate).toBe('2026-09-10')
  })

  it('a Trace/scrubber attempt (non-null checkpoint_results) uses the raw ratio, not the plain boolean, at TRACE_K_MULTIPLIER', () => {
    const attempt = makeAttempt({
      id: 't1',
      puzzleRating: 1300,
      correct: false, // scoreScrubberAttempt-style all-or-nothing would be false here
      checkpoint_results: [
        { correct: false, choiceIndex: 1 },
        { correct: true, choiceIndex: 2 },
      ],
      createdAt: '2026-09-10T00:00:00.000Z',
    })
    const data = expectMerged(
      merge(makeExport({ attempts: [attempt] }), makeExport({ attempts: [] })),
    )
    // 1 of 2 checkpoints correct -> raw ratio 0.5, kMultiplier 1.5 (TRACE_K_MULTIPLIER)
    const expected = updateRating(INITIAL_RATING, 1300, 0.5, 0, 1.5)
    expect(data.profile.rating).toBe(expected)
    expect(data.profile.ratedAttemptCount).toBe(1)
  })
})

describe('merge — per-field rules', () => {
  it('anonId always keeps local, never the pulled value', () => {
    const local = makeExport({ profile: { ...createDefaultProfile(), anonId: 'local-anon' } })
    const remote = makeExport({
      exportedAt: '2099-01-01T00:00:00.000Z',
      profile: { ...createDefaultProfile(), anonId: 'remote-anon' },
    })
    const data = expectMerged(merge(local, remote))
    expect(data.profile.anonId).toBe('local-anon')
  })

  it('firstRunCompleted is OR -- true on either side wins, never reverts to false', () => {
    const a = makeExport({ profile: { ...createDefaultProfile(), firstRunCompleted: true } })
    const b = makeExport({
      exportedAt: '2099-01-01T00:00:00.000Z',
      profile: { ...createDefaultProfile(), firstRunCompleted: false },
    })
    expect(expectMerged(merge(a, b)).profile.firstRunCompleted).toBe(true)
    expect(expectMerged(merge(b, a)).profile.firstRunCompleted).toBe(true)
  })

  it('bestRunStreak is max', () => {
    const a = makeExport({ profile: { ...createDefaultProfile(), bestRunStreak: 5 } })
    const b = makeExport({ profile: { ...createDefaultProfile(), bestRunStreak: 12 } })
    expect(expectMerged(merge(a, b)).profile.bestRunStreak).toBe(12)
  })

  it('preferences/challengerName/requeueState/storagePersisted follow whichever side has the later exportedAt', () => {
    const a = makeExport({
      exportedAt: '2026-09-10T00:00:00.000Z',
      profile: { ...createDefaultProfile(), challengerName: 'Alice', storagePersisted: false },
    })
    const b = makeExport({
      exportedAt: '2026-09-11T00:00:00.000Z',
      profile: { ...createDefaultProfile(), challengerName: 'Bob', storagePersisted: true },
    })
    const data = expectMerged(merge(a, b))
    expect(data.profile.challengerName).toBe('Bob')
    expect(data.profile.storagePersisted).toBe(true)
  })

  it('dailyCompletion prefers the later calendar date regardless of which export is newer', () => {
    const staleButRecentlyExported = makeExport({
      exportedAt: '2026-09-12T00:00:00.000Z',
      profile: {
        ...createDefaultProfile(),
        dailyCompletion: { date: '2026-09-05', attemptId: 'old', correct: true },
      },
    })
    const olderExportButNewerDate = makeExport({
      exportedAt: '2026-09-10T00:00:00.000Z',
      profile: {
        ...createDefaultProfile(),
        dailyCompletion: { date: '2026-09-10', attemptId: 'new', correct: false },
      },
    })
    const data = expectMerged(merge(staleButRecentlyExported, olderExportButNewerDate))
    expect(data.profile.dailyCompletion?.date).toBe('2026-09-10')
    expect(data.profile.dailyCompletion?.attemptId).toBe('new')
  })

  it('rushStats: non-null wins over null, else max/latest per sub-field', () => {
    const withStats = makeExport({
      profile: {
        ...createDefaultProfile(),
        rushStats: { bestScore: 10, bestStreak: 3, runs: 2, lastRunAt: '2026-09-10T00:00:00.000Z' },
      },
    })
    const withNull = makeExport({ profile: { ...createDefaultProfile(), rushStats: null } })
    expect(expectMerged(merge(withStats, withNull)).profile.rushStats).toEqual(
      withStats.profile.rushStats,
    )

    const higher = makeExport({
      profile: {
        ...createDefaultProfile(),
        rushStats: { bestScore: 20, bestStreak: 1, runs: 5, lastRunAt: '2026-09-11T00:00:00.000Z' },
      },
    })
    const merged = expectMerged(merge(withStats, higher)).profile.rushStats
    expect(merged).toEqual({
      bestScore: 20,
      bestStreak: 3,
      runs: 5,
      lastRunAt: '2026-09-11T00:00:00.000Z',
    })
  })

  it("bossStats: bestRunSplits travels with whichever side's bestDepth actually won, not independently maxed", () => {
    const shallowerButHigherSplitsWouldBeWrong = makeExport({
      profile: {
        ...createDefaultProfile(),
        bossStats: {
          bestDepth: 3,
          clears: 0,
          runs: 1,
          lastRunAt: '2026-09-10T00:00:00.000Z',
          bestRunSplits: [1, 2, 3],
        },
      },
    })
    const deeper = makeExport({
      profile: {
        ...createDefaultProfile(),
        bossStats: {
          bestDepth: 7,
          clears: 1,
          runs: 1,
          lastRunAt: '2026-09-11T00:00:00.000Z',
          bestRunSplits: [9, 9, 9, 9, 9, 9, 9],
        },
      },
    })
    const merged = expectMerged(merge(shallowerButHigherSplitsWouldBeWrong, deeper)).profile
      .bossStats
    expect(merged?.bestDepth).toBe(7)
    expect(merged?.bestRunSplits).toEqual([9, 9, 9, 9, 9, 9, 9])
  })

  it('missionProgress: non-null wins over null; if both non-null, latest wins wholesale (no field-level submerge)', () => {
    const inProgress = {
      runId: 'run-a',
      currentStage: 'speed' as const,
      completedStages: [],
      startedAt: '2026-09-10T00:00:00.000Z',
    }
    const a = makeExport({ profile: { ...createDefaultProfile(), missionProgress: inProgress } })
    const b = makeExport({ profile: { ...createDefaultProfile(), missionProgress: null } })
    expect(expectMerged(merge(a, b)).profile.missionProgress).toEqual(inProgress)
  })

  it("unknown profile keys (a newer/different client's payload) are preserved verbatim, never dropped", () => {
    const a = makeExport({
      exportedAt: '2026-09-10T00:00:00.000Z',
      profile: { ...createDefaultProfile(), futureField: 'from-local' } as UserProfile,
    })
    const b = makeExport({ exportedAt: '2026-09-11T00:00:00.000Z' })
    const data = expectMerged(merge(a, b))
    expect((data.profile as unknown as Record<string, unknown>).futureField).toBe('from-local')
  })
})

describe('merge — I11 idempotence: merging the same pulled revision twice is a no-op', () => {
  it.each(ALL_FIXTURES.map((f, i) => [i, f] as const))(
    'fixture %i: merge(merge(local, remote), remote) === merge(local, remote)',
    (_i, remote) => {
      const local = makeExport({ attempts: [] })
      const once = expectMerged(merge(local, remote))
      const twice = expectMerged(merge(once, remote))
      expect(twice).toEqual(once)
    },
  )
})

describe('merge — property tests over the real fixtures (fast-check)', () => {
  it('merge(a, a) is stable under a repeated self-merge', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_FIXTURES), (fixture) => {
        const once = expectMerged(merge(fixture, fixture))
        const twice = expectMerged(merge(once, once))
        expect(twice).toEqual(once)
      }),
    )
  })

  it('merge(a, b) === merge(b, a) — commutative, except anonId (deliberately keep-local, tested separately below)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_FIXTURES), fc.constantFrom(...ALL_FIXTURES), (a, b) => {
        const forward = expectMerged(merge(a, b))
        const backward = expectMerged(merge(b, a))
        expect({ ...forward, profile: { ...forward.profile, anonId: null } }).toEqual({
          ...backward,
          profile: { ...backward.profile, anonId: null },
        })
      }),
    )
  })

  it('merge never decreases the attempts count or a rating-affecting best vs. either input', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_FIXTURES), fc.constantFrom(...ALL_FIXTURES), (a, b) => {
        const data = expectMerged(merge(a, b))
        expect(data.attempts.length).toBeGreaterThanOrEqual(
          Math.max(a.attempts.length, b.attempts.length),
        )
        expect(data.profile.bestRunStreak).toBeGreaterThanOrEqual(
          Math.max(a.profile.bestRunStreak, b.profile.bestRunStreak),
        )
        const bestScore = (p: UserProfile) => p.rushStats?.bestScore ?? -Infinity
        expect(data.profile.rushStats?.bestScore ?? -Infinity).toBeGreaterThanOrEqual(
          Math.max(bestScore(a.profile), bestScore(b.profile)),
        )
        const bestDepth = (p: UserProfile) => p.bossStats?.bestDepth ?? -Infinity
        expect(data.profile.bossStats?.bestDepth ?? -Infinity).toBeGreaterThanOrEqual(
          Math.max(bestDepth(a.profile), bestDepth(b.profile)),
        )
        const completions = (p: UserProfile) => p.missionStats?.completions ?? -Infinity
        expect(data.profile.missionStats?.completions ?? -Infinity).toBeGreaterThanOrEqual(
          Math.max(completions(a.profile), completions(b.profile)),
        )
      }),
    )
  })

  it('every merge result stamps CURRENT_SCHEMA_VERSION and keeps anonId from whichever side is "local" in that call', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_FIXTURES), fc.constantFrom(...ALL_FIXTURES), (a, b) => {
        const data = expectMerged(merge(a, b))
        expect(data.schema_version).toBe(CURRENT_SCHEMA_VERSION)
        expect(data.profile.anonId).toBe(a.profile.anonId)
      }),
    )
  })
})
