/**
 * Orchestrates the Boss loop: serve the run's active BOSS_SETS entry in
 * fixed order, 3-strikes-ends-it (BOSS_STRIKE_LIMIT), best-depth-ever
 * persistence. Deliberately much simpler than useRushSession: no
 * per-puzzle clock (Boss's settled design questions never call for one —
 * see the Boss Challenges plan's design record), and no live difficulty
 * selection (each run's order is a fixed, pre-authored sequence, see
 * bossRun.ts) — so there's no widening pool, no rng, no interval/
 * visibilitychange machinery to manage.
 *
 * BOSS_SETS rotation (engagement pass): a run no longer always plays the
 * same 10 puzzles — resolveActiveBossSet(runsCompleted) picks which
 * BOSS_SETS entry this run serves, keyed off bossStats.runs at the moment
 * the run starts. That resolution happens exactly ONCE per run, in
 * startRun, and is cached in activeSetRef for the run's entire lifetime —
 * never recomputed per puzzle. This matters: bossStats.runs only changes
 * when a run ends (endRun writes the incremented count), so nothing
 * *could* change it mid-run today, but resolving it once at run start
 * rather than reading BOSS_SETS/profile.bossStats.runs live on every
 * serveAt call is still the deliberate contract — it's what makes "this
 * run stays on one set from puzzle 1 to its end" true by construction
 * rather than true by accident of when runs happens to change.
 *
 * Ghost pace (engagement pass): runStartAtRef/splitsRef capture elapsed-ms-
 * per-position for THIS run, in position order, reset by startRun exactly
 * like strikes/position ("Run it back" gets a clean split trace too). At
 * run end, endRun snapshots `previousBestSplits` from the profile's stored
 * bossStats.bestRunSplits BEFORE writing anything — this is deliberate: it
 * is the run being raced against, and stays the prior record even when
 * THIS run just set a new bestDepth (which overwrites the stored value for
 * next time, but must not change what THIS run's own summary compares
 * against). `bestRunSplits` in storage is overwritten wholesale only when
 * isNewBestDepth; every ordinary run leaves it untouched. This is a static
 * post-run comparison only — never a live animated race, per the Boss
 * engagement pass's locked decisions (no simulated opponent, no per-puzzle
 * clock added to Boss).
 *
 * "Depth reached" is the run's score: the 1-indexed position of the last
 * puzzle the run reached, whether that puzzle was answered right or wrong,
 * capped at the active set's length. This always hits that length once a
 * run gets that far — there's no puzzle 11 to fail into — so depth alone
 * can't distinguish "answered puzzle 10 correctly" from "answered it wrong
 * but it wasn't the 3rd strike" from "answered it wrong AS the 3rd
 * strike". `cleared` is the fact that actually makes that distinction:
 * true only when the run reached the end of the sequence WITHOUT being
 * struck out (`finalStrikes < BOSS_STRIKE_LIMIT`) — a run that reaches the
 * last puzzle and loses its 3rd strike there is `cleared: false`, exactly
 * like striking out on any earlier puzzle. `ended_reason` names which of
 * the two ending conditions actually fired (`'strikes'` vs `'completed'`),
 * independent of `cleared`/`depthReached` — Amendment finding from the
 * Phase 1 final review: an earlier draft computed `cleared` from depth
 * alone (true whenever position reached the end, regardless of the final
 * answer) and documented an `ended_reason` field this file never actually
 * shipped — both fixed together here, since they're the same underlying
 * question ("what does a run's outcome actually mean?").
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
import { getPuzzleBody, BOSS_SETS, resolveActiveBossSet } from '../../content'
import { isDevPuzzleModeEnabled, resolveBossStubPuzzle } from '../devTools/devPuzzleMode'
import type { Puzzle as ContentPuzzle } from '../../content'
import { trackError, trackBossAttempt, trackBossRunEnd } from '../../telemetry'
import type { ChallengeAttemptInput } from '../../challenge'
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
  /** True only when the run reached the active set's length WITHOUT being struck out — see this file's doc comment for why depth alone can't tell the two apart. */
  cleared: boolean
  /** All-time deepest run, post this run's update. */
  bestDepthEver: number
  /** True when this run's depthReached just beat the profile's prior all-time bestDepth. */
  isNewBestDepth: boolean
  /**
   * This run's own elapsed-ms-per-position splits — index i is the time from
   * run start to answering the puzzle at position i+1, length === depthReached.
   * Ghost-pace comparison data (see this file's own doc comment); never a
   * live/animated race — see the Boss engagement pass's locked decisions.
   */
  splits: number[]
  /**
   * The prior best-depth run's splits — captured BEFORE this run started, so
   * it's always the run this run is racing against, even if this run just set
   * a new bestDepth itself (see endRun's own comment for why the *new*
   * bestRunSplits it writes is never read back here). Null when no prior
   * best-depth run ever recorded splits (the very first run, or a bestDepth
   * that predates this field via the v7->v8 migration).
   */
  previousBestSplits: number[] | null
}

export interface BossSession {
  status: BossSessionStatus
  phase: BossPhase
  profile: UserProfile | null
  puzzle: ContentPuzzle | null
  strikes: number
  /** 1-indexed position of the currently served puzzle within this run's active set. */
  position: number
  /** Length of this run's active set (BOSS_SETS rotation) — always the current run's real puzzle count, not a hardcoded constant. */
  totalPuzzles: number
  /** Populated once phase === 'ended'. */
  runSummary: BossRunSummary | null
  /** True once the just-answered puzzle's outcome means the NEXT Continue tap ends the run (3rd strike, or the set's last puzzle) — see useRushSession.ts's identical field for the full rationale (2b.2 click-meaningfulness fix). */
  willEndOnContinue: boolean
  /**
   * Whether the CURRENT puzzle's answer was correct — undefined/null until
   * answered, reset to null once a new puzzle is served (2b.2 Boss
   * game-feel pass: drives the correct-answer "landed a hit" beat, the
   * counterpart to the wrong-answer hit-reaction the health bar already
   * had). `strikes` alone can't drive this: it only changes on a MISS, so a
   * correct answer needs its own signal.
   */
  lastAnswerCorrect: boolean | null
  /** Bumped once per handleAnswered call — a remount key so the character reaction (keyed off it) replays its CSS animation on every answer, correct or wrong, the same `key={strikes}` trick the health bar's own hit-reaction already uses. */
  answerNonce: number
  /** Every attempt of the current run, in play order (correct and incorrect alike) — feeds the end-of-run challenge link (challenge redesign — Boss's first-ever challenge affordance). Reset by startRun. Mirrors useRushSession.ts's identical `runAttempts` field. */
  runAttempts: readonly ChallengeAttemptInput[]
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
  // Mirrors activeSetRef.current.length as real state (not a ref read at
  // render time — eslint's react-hooks/refs rule disallows accessing
  // ref.current during render): set once per run start, alongside
  // strikes/position, from the same activeSet startRun just resolved.
  const [totalPuzzles, setTotalPuzzles] = useState(() => resolveActiveBossSet(0).length)
  const [runSummary, setRunSummary] = useState<BossRunSummary | null>(null)
  const [willEndOnContinue, setWillEndOnContinue] = useState(false)
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState<boolean | null>(null)
  const [answerNonce, setAnswerNonce] = useState(0)
  const [runAttempts, setRunAttempts] = useState<ChallengeAttemptInput[]>([])

  const runIdRef = useRef(crypto.randomUUID())
  const servedAtRef = useRef(0)
  const pendingEndRef = useRef(false)
  const pendingNextIndexRef = useRef(0)
  const cancelledRef = useRef(false)

  // This run's resolved BOSS_SETS entry + its index, cached once at
  // startRun and read (never recomputed) by serveAt/endRun/handleAnswered
  // for the rest of the run — see this file's own doc comment.
  const activeSetRef = useRef<readonly string[]>(resolveActiveBossSet(0))
  const setIndexRef = useRef(0)

  // Ghost-pace capture: runStartAtRef is stamped once at startRun;
  // splitsRef accumulates one elapsed-ms entry per puzzle answered, in
  // position order (see handleAnswered) — reset by startRun the same way
  // strikes/position are, so "Run it back" starts a clean split trace too.
  const runStartAtRef = useRef(0)
  const splitsRef = useRef<number[]>([])

  // Task 6 (content-metadata-lazy-load follow-up): was `new Map(quizPool.map(...))`
  // — an eager Map over the ENTIRE quizPool built once at hook creation.
  // Replaced with a targeted prefetch of exactly the active set's 10 ids,
  // resolved once in startRun (below) before the run's first puzzle is
  // served — never per-puzzle mid-run, since boss sets are small and fixed.
  // Starts empty; populated by startRun before every serveAt call that
  // needs it.
  const contentByIdRef = useRef<Map<string, ContentPuzzle>>(new Map())
  // Review fix (post-Task-6): `startRun` is a plain callback, not a
  // re-running effect — but it CAN itself be invoked more than once while
  // still mounted (mount, and every "Run it back" via handleRunItBack,
  // which has no guard against a second click landing before the first
  // run's prefetch has resolved). Two overlapping prefetches would race the
  // same way PuzzlePage.tsx's id-change race did: whichever
  // Promise.all(...) happens to settle LAST wins and silently overwrites
  // `contentByIdRef`/`serveAt(0)`, even if it was the OLDER of the two
  // calls. This token is bumped once per startRun call and checked after
  // the prefetch settles, so only the most recently started run can ever
  // apply its result — same "compare against the latest, not a boolean
  // flag" fix as PuzzlePage.tsx/useChallengeSession.ts. `cancelledRef`
  // above still separately covers true unmount (it's reset exactly once,
  // by the single mount-only effect below, so it doesn't have the
  // reset-clobbers-a-concurrent-run problem the boolean-flag pattern had
  // in the other two files).
  const startRunTokenRef = useRef(0)

  const serveAt = useCallback((index: number) => {
    setWillEndOnContinue(false)
    setLastAnswerCorrect(null)
    // Dev-stub swap (see devPuzzleMode.ts's own doc comment): the curated
    // BOSS_SETS ids don't exist in DEV_STUB_PUZZLES, so — unlike
    // useRushSession's resolvePool(quizPool), which swaps the whole pool —
    // Boss branches explicitly and asks for a stub keyed by run position,
    // the same fix Daily already needed for its own curated calendar.
    if (isDevPuzzleModeEnabled()) {
      setPuzzle(resolveBossStubPuzzle(index))
      setPosition(index + 1)
      servedAtRef.current = Date.now()
      setStatus('ready')
      return
    }
    const id = activeSetRef.current[index]
    if (id === undefined) {
      setPuzzle(null)
      setStatus('empty')
      return
    }
    const fullPuzzle = contentByIdRef.current.get(id)
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

  const startRun = useCallback(
    (activeProfile: UserProfile) => {
      const runsCompleted = activeProfile.bossStats?.runs ?? 0
      const activeSet = resolveActiveBossSet(runsCompleted)
      activeSetRef.current = activeSet
      setIndexRef.current = runsCompleted % BOSS_SETS.length
      runIdRef.current = crypto.randomUUID()
      pendingEndRef.current = false
      pendingNextIndexRef.current = 0
      runStartAtRef.current = Date.now()
      splitsRef.current = []
      setPhase('playing')
      setStrikes(0)
      setTotalPuzzles(activeSet.length)
      setRunSummary(null)
      setRunAttempts([])
      // Task 6 (content-metadata-lazy-load follow-up): prefetch exactly this
      // run's active set, once, before serving its first puzzle — never
      // per-puzzle mid-run (boss sets are small and fixed, so resolving all
      // 10 up front is simpler and cheap). `status` stays 'loading' for this
      // window (the same status BossPage.tsx already renders for the
      // initial profile load), so a run start — including "Run it back",
      // which re-enters this same function — never briefly shows a stale or
      // missing puzzle while its set's bodies are still in flight.
      setStatus('loading')
      // See startRunTokenRef's own doc comment: guards against a second
      // startRun call (a fast repeat "Run it back" click) superseding this
      // one before this prefetch has resolved.
      const token = ++startRunTokenRef.current
      void (async () => {
        try {
          const bodies = await Promise.all(activeSet.map((id) => getPuzzleBody(id)))
          if (cancelledRef.current || startRunTokenRef.current !== token) return
          const map = new Map<string, ContentPuzzle>()
          activeSet.forEach((id, i) => {
            const body = bodies[i]
            if (body) map.set(id, body)
          })
          contentByIdRef.current = map
          serveAt(0)
        } catch (error) {
          // getPuzzleBody can reject (a failed dynamic import — offline, or
          // a deploy-invalidated chunk — or the zod validation throw on
          // invalid content, which now runs in production too, unlike
          // puzzlePool's DEV-only validation). Without this catch the run
          // would hang in `status: 'loading'` forever — and, notably, this
          // IIFE's rejection would NOT be caught by loadAndStart's own
          // try/catch below even though this code runs textually inside
          // it: a `void`-ed async function's rejection is not caught by an
          // enclosing sync try/catch, only by its own. Reuses the same
          // 'error' status + retryLoad recovery path loadProfile failures
          // already have — a prefetch failure is just one more way a run
          // can fail to start, not a new state to invent.
          if (cancelledRef.current || startRunTokenRef.current !== token) return
          trackError(error, 'useBossSession: puzzle body prefetch failed')
          setStatus('error')
        }
      })()
    },
    [serveAt],
  )

  /** Shared by the mount effect and retryLoad — was duplicated verbatim before (Phase 1 final review finding); one copy now, one error-context string. */
  const loadAndStart = useCallback(() => {
    void (async () => {
      try {
        const loaded = await loadProfile()
        if (cancelledRef.current) return
        setProfile(loaded)
        startRun(loaded)
      } catch (error) {
        if (cancelledRef.current) return
        trackError(error, 'useBossSession: loadProfile failed')
        setStatus('error')
      }
    })()
  }, [startRun])

  useEffect(() => {
    cancelledRef.current = false
    loadAndStart()
    return () => {
      cancelledRef.current = true
    }
    // Mount-only, same convention as useRushSession.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retryLoad = useCallback(() => {
    cancelledRef.current = false
    setStatus('loading')
    loadAndStart()
  }, [loadAndStart])

  const endRun = useCallback(
    (currentProfile: UserProfile, finalPosition: number, finalStrikes: number) => {
      const struckOut = finalStrikes >= BOSS_STRIKE_LIMIT
      const cleared = finalPosition >= activeSetRef.current.length && !struckOut
      const priorStats = currentProfile.bossStats
      const isNewBestDepth = finalPosition > (priorStats?.bestDepth ?? 0)
      // The run this run is racing against: the best-depth run recorded
      // BEFORE this one started. Captured here, before newBossStats
      // potentially overwrites bestRunSplits below — never read back from
      // newBossStats itself, so a run that just set a new best still
      // compares against the PRIOR record, not against its own splits.
      const previousBestSplits = priorStats?.bestRunSplits ?? null
      const thisRunSplits = [...splitsRef.current]
      const newBossStats: BossStats = {
        bestDepth: Math.max(priorStats?.bestDepth ?? 0, finalPosition),
        clears: (priorStats?.clears ?? 0) + (cleared ? 1 : 0),
        runs: (priorStats?.runs ?? 0) + 1,
        lastRunAt: new Date().toISOString(),
        // Overwritten wholesale only when this run set a new bestDepth —
        // ordinary (non-record) runs leave the stored bestRunSplits
        // untouched, per BossStatsSchema's own doc comment.
        bestRunSplits: isNewBestDepth ? thisRunSplits : previousBestSplits,
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
        ended_reason: struckOut ? 'strikes' : 'completed',
        is_new_best_depth: isNewBestDepth,
        set_index: setIndexRef.current,
      })
      setRunSummary({
        depthReached: finalPosition,
        cleared,
        bestDepthEver: newBossStats.bestDepth,
        isNewBestDepth,
        splits: thisRunSplits,
        previousBestSplits,
      })
      setPhase('ended')
    },
    [],
  )

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
        set_index: setIndexRef.current,
      })

      // Ghost-pace split: cumulative elapsed time from run start to
      // answering this position, pushed once per position in order — see
      // this file's own doc comment and BossRunSummary.splits.
      splitsRef.current.push(Math.max(0, Date.now() - runStartAtRef.current))

      const newStrikes = payload.correct ? strikes : strikes + 1
      setStrikes(newStrikes)
      setLastAnswerCorrect(payload.correct)
      setAnswerNonce((n) => n + 1)
      // Every answer lands in the run's challenge-link sequence, correct and
      // incorrect alike — the link replays the whole run as it happened
      // (mirrors useRushSession.ts's identical `runAttempts` accumulation).
      setRunAttempts((prev) => [
        ...prev,
        { puzzleId: puzzle.id, correct: payload.correct, time_ms: timeMs },
      ])

      const reachedEnd = position >= activeSetRef.current.length
      const willEnd = newStrikes >= BOSS_STRIKE_LIMIT || reachedEnd
      pendingEndRef.current = willEnd
      setWillEndOnContinue(willEnd)
      pendingNextIndexRef.current = position
    },
    [profile, puzzle, phase, strikes, position],
  )

  const handleContinue = useCallback(() => {
    if (!profile || phase !== 'playing') return
    if (pendingEndRef.current) {
      endRun(profile, position, strikes)
      return
    }
    serveAt(pendingNextIndexRef.current)
  }, [profile, phase, position, strikes, serveAt, endRun])

  const handleRunItBack = useCallback(() => {
    if (!profile) return
    startRun(profile)
  }, [profile, startRun])

  return {
    status,
    phase,
    profile,
    puzzle,
    strikes,
    position,
    totalPuzzles,
    runSummary,
    willEndOnContinue,
    lastAnswerCorrect,
    answerNonce,
    runAttempts,
    handleAnswered,
    handleContinue,
    handleRunItBack,
    retryLoad,
  }
}
