# Selection-engine audit for the content metadata/body lazy-load split

Findings for Task 1 of `docs/superpowers/plans/2026-08-24-content-metadata-lazy-load.md`.
Consumed by Task 5 (speculative prefetch + stale-while-revalidate).

Question this answers: **does the selection algorithm expose (or can it cheaply be
made to expose) a ranked list of "next-most-likely" candidate puzzle ids, not just
the single chosen one?**

Short answer: **no ranking exists anywhere, because nothing is ever scored** — the
final pick is a uniform random draw from an unordered eligible set. But selection is
fully pure and O(pool)-cheap, so Task 5 can re-run it speculatively. Recommendation
is **(b)**, with a hit-rate caveat that matters for how Task 5 sets expectations.
See [Step 3](#step-3-decision).

---

## Step 1: The selection algorithm (`src/engine/selection.ts`)

### 1.1 Exported signatures

The module exports one function and five types. Verbatim:

```ts
export interface Puzzle {
  id: string
  rating: number
}

export type Rng = () => number

export type SelectionSource = 'requeue' | 'window'

export interface SelectionResult {
  readonly puzzle: Puzzle
  readonly source: SelectionSource
  readonly newRequeueState: RequeueState
}

export interface SelectionInput {
  readonly pool: readonly Puzzle[]
  readonly rating: number
  readonly recentIds: readonly string[]
  readonly requeueState: RequeueState
  readonly rng: Rng
  readonly lastSource: SelectionSource | null
}

export function selectNext(input: SelectionInput): SelectionResult | null
```

Everything else is module-private: `pickFromWindow`, `widenedEligible`,
`withinWindow`, `sample`, and the constants `MIN_ELIGIBLE = 10`,
`BASE_HALF_WINDOW = 200`, `WIDEN_STEP = 100`.

`selectNext` returns `null` **only** when `pool.length === 0` (`selection.ts:76-78`),
and in that case deliberately does not advance the requeue ladder.

### 1.2 Does selection depend on mutable state across calls?

**`selectNext` itself is a pure function of its `input`. Calling it a second time
mutates nothing.** This is the load-bearing finding for Task 5, so here is the
evidence rather than an assertion:

**The requeue ladder is never mutated in place — it is threaded through the
parameter and returned as a new value.** `selection.ts:81` destructures
`advance(requeueState)` and `selection.ts:98` calls `resurface(ticked, ...)`. Both
are immutable in `src/engine/requeue.ts`:

- `advance` (`requeue.ts:76-80`) is `state.map((entry) => ({ ...entry, served: entry.served + 1 }))` — a new array of freshly spread objects, then a `filter` for `due`. The input array and its entries are untouched.
- `resurface` (`requeue.ts:88-99`) is a `flatMap` returning `[entry]`, `[]`, or `[{ ...entry, stage: nextStage, served: 0 }]`. Again all-new objects.
- `recordMiss` (`requeue.ts:60-66`) is `map`/spread as well, but it is never called by `selectNext` — only by the hooks on a wrong answer.

The ladder therefore only actually advances **if the caller stores
`result.newRequeueState`**. Every caller does that as an explicit, separate
statement — `usePracticeSession.ts:151` and `useTraceSession.ts:213`, both
`setProfile({ ...currentProfile, requeueState: result.newRequeueState })`. A
speculative call that discards its `SelectionResult` advances nothing at all.

**The other inputs are read-only.** `pool` is only ever `.find`/`.filter`/`.map`'d
(`selection.ts:93, 142, 154`). `recentIds` is copied into `new Set(recentIds)` and
used for lookups (`selection.ts:122-123`). No assignment to any input occurs
anywhere in the file.

**The one genuinely stateful input is `rng`** — and it is a non-issue in production.
Details, because this is exactly the thing the task brief warns against getting
wrong:

- `selectNext` calls `rng()` **zero or one** times. Zero on the requeue path: the
  early `return` at `selection.ts:95-99` happens before `pickFromWindow` is ever
  reached. Exactly one on the window path, in `sample` (`selection.ts:158`).
- So one speculative call consumes **at most one draw** from whatever `Rng` closure
  it is handed.
- **Every production call site passes `rng: Math.random`** — `usePracticeSession.ts:132`,
  `useTraceSession.ts:192`, and (for the Rush variant) `useRushSession.ts:186`. That
  is a global, unseeded PRNG whose sequence nothing in the app reads, asserts on, or
  reproduces. Advancing it extra times has no observable effect on anything.
- Only `selection.test.ts` injects a seeded closure (`mulberry32`, lines 8-17), and
  even there each `selectNext` call is handed a **freshly constructed** closure
  (`mulberry32(42)`, `mulberry32(seed)`, `mulberry32(tick)`), so there is no
  long-lived seeded sequence to desynchronise. The determinism test at
  `selection.test.ts:293-307` asserts `run()` equals `run()` precisely because each
  `run()` builds a new `mulberry32(12345)`.

**One caveat to carry into Task 5.** The purity above holds for `Math.random`. If a
future change ever seeds the RNG per session (a single `mulberry32` closure held in a
ref, e.g. for replayable sessions), speculative calls _would_ shift that sequence and
change which puzzle the real call subsequently serves. That would not corrupt state or
produce an invalid puzzle, but it would break reproducibility. Task 5 should therefore
either keep passing `Math.random`, or pass a **separate throwaway `Rng`** into
speculative calls so the real sequence is never touched. Cheap to do now, so do it now.

### 1.3 Is there a natural "second choice" / ranked intermediate?

**No — nothing is ever scored, so there is no ranking to expose.** But the two paths
differ, and the difference matters:

**Requeue path (`selection.ts:91-102`) — an ordered list already exists and is
discarded.** `advance` returns `due`, a list of due entries in earliest-missed
insertion order (`requeue.ts:78`; the ordering guarantee is documented at
`requeue.ts:44-49` and `71-75`). `selectNext` loops it and takes the first entry
whose puzzle is still in the pool. So the runner-up requeue candidates _are_
computed and thrown away. This is the one place a genuine "second choice" is
meaningful — and it is nearly deterministic, which makes it the highest-value
prefetch target in the whole algorithm. Caveat: this whole block is skipped whenever
`lastSource === 'requeue'` (the starvation guard, documented at `selection.ts:43-60`),
so a prefetcher must model that guard to know whether the next serve can be a
requeue at all.

**Window path (`pickFromWindow`, `selection.ts:111-127`) — unranked and uniform.**
The pipeline is:

1. `widenedEligible` (`selection.ts:141-151`): everything within `±200` of the user's
   rating, widening by `100` until `>= 10` are eligible or the window covers the pool.
   This is a **set membership test, not a score** — a puzzle 5 points off-rating and
   one 195 points off are equally eligible with no ordering between them.
2. `notRecent` filter: drops ids in `recentIds`, with a soft fallback to the full
   eligible set if that would empty it (`selection.ts:122-124`).
3. `sample` (`selection.ts:157-165`): `items[Math.floor(rng() * items.length)]` —
   a single uniform draw. **Every member of `candidates` is exactly equally likely.**

So there is no top-K, no runner-up, and no scored intermediate on the window path.
There _is_ an exposed-in-principle **candidate set** (`candidates` in `pickFromWindow`),
which is the more useful object anyway — but because the draw is uniform, knowing the
set tells you no more about the next pick than drawing from it does. This is why
option (a) would not actually beat option (b); see Step 3.

**How big is that candidate set in practice?** Measured against the real content.
Total content is 214 puzzles (ratings 800–2125), but **Practice's pool is `quizPool`,
which excludes the 43 scrubber puzzles** (`content/index.ts:58-60`) — so 171, not 214.
Trace uses the 43-puzzle `scrubberPool` complement (`content/index.ts:63-65`).

Eligible counts in the base `±200` window, unfiltered:

| Rating centre | `quizPool` (Practice) | `scrubberPool` (Trace) |
| ------------- | --------------------- | ---------------------- |
| 1000          | 66                    | —                      |
| 1200          | 93                    | 15                     |
| 1400          | 85                    | —                      |
| 1500          | 78                    | 16                     |
| 1600          | 62                    | —                      |
| 1800          | 30                    | 12                     |

Minus up to 20 `recentIds`, an **unfiltered** Practice candidate set runs roughly
10–73 puzzles depending on where the user's rating sits.

With a **pattern filter** active the pool is only that pattern's 11–16 quiz puzzles
(measured per pattern, scrubber excluded: `null-undefined` 11 up to `control-flow` /
`error-handling` 16). Note the interaction this has with `recentIds`: the window
widens until `>= 10` are eligible, which for an 11–16 puzzle pool means essentially
the whole pattern. `recentIds` holds **20** ids, so after a little play within one
pattern the `notRecent` filter empties and the soft fallback at `selection.ts:124`
returns the _full_ eligible set. The candidate set therefore floors out at roughly
the pattern's size (11–16) rather than collapsing to single digits. Only a
**pattern AND interaction** filter together (they combine — `usePracticeSession.ts:48`)
drives it into the low single digits.

Interaction-only splits, for reference: `mcq` 60, `swipe-binary` 61, `tap-line` 27,
`drag-order` 23 (plus the 43 scrubber, excluded from `quizPool`).

### 1.4 Cost

`selectNext` is O(pool): one `Math.max(...pool.map(...))`, one to a few `filter`
passes (one per widening step, and widening is rare once 10+ are eligible), plus one
`pool.find` per due requeue entry. At a 171-puzzle pool this is microseconds — 3-5x
is free relative to a network fetch. (Aside, pre-existing and not introduced by
prefetch: `Math.max(...pool.map(...))` at `selection.ts:142` spreads the pool into
argument positions, which would blow the argument limit at a pool in the tens of
thousands. Irrelevant at this size, worth knowing if content ever scales hard.)

---

## Step 2: How the session hooks call it

### 2.1 Do all three share one selection call?

**No. They use three different mechanisms, and only one of them is `selectNext`.**
There is no single interception point Task 5 can wrap.

| Mode         | Selection mechanism                                                | Randomness?                      |
| ------------ | ------------------------------------------------------------------ | -------------------------------- |
| **Practice** | `selectNext` (`usePracticeSession.ts:127`)                         | Yes — uniform over a wide window |
| **Daily**    | None. Deterministic calendar lookup (`useDailySession.ts:74-81`)   | No                               |
| **Rush**     | `selectRushPuzzle` from `engine/rush.ts` (`useRushSession.ts:182`) | Yes — weighted-then-uniform      |

Two further consumers the brief did not name, which Task 5 **must** account for:

| Mode      | Selection mechanism                                                                             | Randomness? |
| --------- | ----------------------------------------------------------------------------------------------- | ----------- |
| **Trace** | `selectNext` — a _fourth_ caller, structurally identical to Practice (`useTraceSession.ts:187`) | Yes         |
| **Boss**  | None. Fixed id list by index (`useBossSession.ts:179-210`)                                      | No          |

**Practice** (`usePracticeSession.ts:124-163`): pool is
`poolForFilters(pattern, interaction).map(toEnginePuzzle)` — `resolvePool(quizPool)`
filtered by pattern AND interaction (they combine, they are not exclusive; see the
doc comment at `:48`). Passes `rng: Math.random`, commits `newRequeueState` into
profile state at `:151`, and records `result.source` into `lastSourceRef` at `:143`.

**Daily** (`useDailySession.ts:74-81`): computes the id synchronously during render,
before any load, as
`DAILY_CALENDAR[getDailyCalendarIndex(today, DAILY_CALENDAR.length)]`, where
`getDailyCalendarIndex` is `positiveMod(getDailyNumber(date) - 1, len)`
(`engine/daily.ts:52-59`) and `getDailyNumber` is a pure day-count from a fixed epoch.
**There is no candidate set — there is exactly one id, computable for any date
including future ones, with zero engine cost and zero randomness.** Daily needs no
candidate machinery whatsoever; a prefetcher can warm today's (and tomorrow's) body
directly.

**Rush** (`useRushSession.ts:181-207`): calls `selectRushPuzzle({ pool: rushPool.current,
difficulty: atDifficulty, usedIds: usedIdsRef.current, rng: Math.random })`. `rush.ts`
mirrors `selection.ts`'s structure but is a separate implementation (it says so
explicitly at `rush.ts:5-9` — deliberately not sharing code, since `selection.ts`'s
helpers are private). Relevant differences:

- `MIN_ELIGIBLE = 1`, not 10 (`rush.ts:44`) — much narrower eligible sets.
- `pickWeighted` (`rush.ts:158-170`) splits eligible into swipe-binary vs rest, draws
  `rng() < RUSH_SWIPE_WEIGHT (0.7)` to choose a bucket, then uniform-samples within
  it. So the window path consumes **two** `rng()` calls, not one.
- **Purity is even cleaner than `selectNext`'s**: `usedIds` is typed
  `ReadonlySet<string>` (`rush.ts:69`) and is only ever `.has()`'d (`rush.ts:149`).
  The mutation `usedIdsRef.current.add(puzzle.id)` happens in the _hook_
  (`useRushSession.ts:365`), not the engine. And `RushSelectionResult` is
  `{ puzzle }` only — there is no state to commit, so there is not even a
  discarded-return-value question. `selectRushPuzzle` is unconditionally
  side-effect-free.
- Rush pool is mcq + swipe-binary + tap-line = 148 puzzles (`isRushEligible`,
  `useRushSession.ts:79-87`), shrinking through a run as `usedIds` grows.

**Trace** (`useTraceSession.ts:186-226`): same shape as Practice — own `recentIdsRef`
and `lastSourceRef`, `rng: Math.random`, commits `newRequeueState` at `:213`, over
`resolvePool(scrubberPool).filter(isScrubberPuzzle)` (43 puzzles). Whatever Task 5
builds for Practice applies here verbatim, and Trace's much smaller pool means a
better hit rate than unfiltered Practice.

**Boss** (`useBossSession.ts:179-210`): serves `activeSetRef.current[index]`, a
curated `BOSS_SETS` id list resolved once at `startRun` (`:212-230`). **The entire
run's id sequence is known up front** — trivially and completely prefetchable, with
no engine involvement at all.

### 2.2 What state does each hook hold that a prefetcher must read?

**Practice** — refs (`usePracticeSession.ts:115-122`):

- `recentIdsRef.current: string[]` — last 20 served ids. Updated in `handleContinue`
  (`:325`) and in all three filter setters (`:352`, `:367`, `:388`).
- `lastSourceRef.current: SelectionSource | null` — set at `:143`. **Required** to
  model the requeue starvation guard.
- `contentById` (`:122`) — a `Map` of _every_ content puzzle id to its full puzzle,
  built eagerly at hook init from `poolForFilters(null, null)`. **This is precisely
  the eager structure the lazy-load plan has to break**, and the lookup at `:153`
  (which `throw`s on a miss) is the exact line that becomes async.
- State: `profile.requeueState`, `profile.rating`, `patternFilter`,
  `interactionFilter`, `puzzle`, `servedAtRef`.

Prefetch trigger points: `handleContinue` (`:323`), `setPatternFilter` (`:338`),
`setInteractionFilter` (`:363`), `setFilters` (`:384`), and mount (`:186`). Note the
filter setters change the pool, so any prefetched candidate set must be invalidated
and recomputed when a filter changes.

**Daily** — essentially none. `servedAtRef`, `attemptNonce` (forces a remount for an
unrated retry at the same puzzle, `:202-206`), `profile.dailyCompletion`. Daily serves
one puzzle per calendar day; there is no "next puzzle" within a session to prefetch.

**Rush** — refs (`useRushSession.ts:156-179`):

- `usedIdsRef.current: Set<string>` — no-repeat-within-run; added to at `:365`.
- `pendingDifficultyRef.current` — **the single best prefetch signal in the
  codebase.** Set in `handleAnswered` at `:400` as
  `payload.correct ? stepDifficulty(difficulty) : difficulty`. So the moment the
  player commits an answer — before the Continue tap, with the whole feedback-panel
  dwell time available — the exact difficulty the next `selectRushPuzzle` call will
  use is already known and sitting in a ref.
- `pendingEndRef.current` (`:398`) — true when the next Continue **ends the run**
  instead of serving. A prefetcher must check this and skip prefetching entirely,
  or it wastes a fetch on every run's last puzzle.
- `contentById` (`:178`) and `rushPool` (`:179`) refs, `difficulty`/`strikes` state.

**Trace** — mirrors Practice: `recentIdsRef`, `lastSourceRef`, `contentById`,
`tracePool` (`useTraceSession.ts:169-184`), plus `checkpointResultsRef`.

**Boss** — `activeSetRef.current` (the whole id list) and `pendingNextIndexRef`
(`useBossSession.ts:161-168`). Everything needed is known at `startRun`.

---

## Step 3: Decision

### Recommendation: **(b)** — re-run the real selection function N times

**No natural top-K exists** (Step 1.3: nothing is scored, so there is nothing to rank),
**but selection is verifiably pure and O(pool)-cheap**, so Task 5's prefetch layer
should call the real selection function N extra times to build an approximate
candidate set.

**Why not (a).** A candidate set _does_ exist internally (`candidates` in
`pickFromWindow`) and could be exposed by a small pure refactor. It is not worth it,
and it would not help: because `sample` draws **uniformly** (`selection.ts:158`),
knowing the full set of size _S_ and picking _N_ from it yields the same expected hit
rate — _N/S_ — as simply drawing _N_ times. Exposing the set buys nothing but a wider
engine API surface, new tests against locked selection semantics, and a second
implementation to keep in sync for `rush.ts`. Option (a) is strictly more risk for
identical hit rate.

**Why not (c).** (c) requires selection to be either unsafe to re-run or expensive.
Neither holds. Purity is established line-by-line in Step 1.2 (immutable requeue
helpers, read-only pool/recentIds, `Math.random` at all call sites, ladder advances
only when the caller commits `newRequeueState`). Cost is microseconds at 214 puzzles.

### Exact parameters for Task 5

**N = 3** for Practice, Trace, and Rush. Cost is negligible so N could be larger, but
marginal hit rate falls off and each extra candidate is another body fetch competing
for bandwidth with the real one. 3 is the right starting point; it is a constant, so
tune it after real telemetry.

**Practice / Trace** — for each speculative call `i` in `1..N`, call `selectNext`
with the _same_ `pool` and `rating` as the real call, and:

- `requeueState`: the **real** call's `result.newRequeueState` (not the pre-call
  state) — this models the ladder as it will actually be at the next serve.
- `lastSource`: the **real** call's `result.source` — required, or the prefetcher
  will wrongly predict a requeue serve that the starvation guard will block.
- `recentIds`: `[realResult.puzzle.id, ...recentIdsRef.current].slice(0, 20)` —
  i.e. the window as `handleContinue` (`usePracticeSession.ts:325`) will have set it,
  plus the ids already yielded by speculative calls `1..i-1` so the N draws do not
  collide.
- `rng`: a throwaway `Rng` (see the caveat in Step 1.2), or `Math.random`.

Discard every `SelectionResult` except `.puzzle.id`. **Discarding is safe and is the
whole point** — the ladder does not advance unless committed.

**Rush** — same idea against `selectRushPuzzle`, but simpler and with a better
signal: fire the prefetch from `handleAnswered` (where `pendingDifficultyRef.current`
is already computed, `useRushSession.ts:400`) rather than from `handleContinue`, using
`difficulty: pendingDifficultyRef.current` and `usedIds` extended with the
just-answered id. **Skip entirely when `pendingEndRef.current` is true** (`:398`) —
the run is about to end and no puzzle will be served.

**Daily / Boss — do not use this mechanism at all.** Both are deterministic. Daily:
compute the id directly from `DAILY_CALENDAR[getDailyCalendarIndex(...)]` and prefetch
that one body (hit rate 100%). Boss: the entire run's id list is known at `startRun`,
so prefetch position `index + 1` (or the whole run) directly. Running N speculative
calls for these would be pure waste.

### The caveat Task 5 must plan around

**Prefetch hit rate is low for every randomised mode — materially lower than a
"speculative prefetch" framing suggests.** With N=3 against the measured candidate
sizes from Step 1.3:

- Unfiltered Practice at rating 1200: ~73 candidates after recent-exclusion →
  **~4% hit rate.**
- Unfiltered Practice at rating 1800 (sparse end of the pool): ~10 candidates →
  **~30%.**
- Pattern-filtered Practice: ~11–16 candidates (the `recentIds` fallback at
  `selection.ts:124` keeps it from collapsing further) → **~20-27%.**
- Pattern **and** interaction filtered: low single digits → **approaching 100%.**
- Trace (43-puzzle pool, 12–16 in window): → **~20-25%.**
- Rush: modest, and it is the _only_ randomised mode that improves over time —
  `usedIds` grows monotonically through a run and `MIN_ELIGIBLE = 1` keeps windows
  tight, so the candidate set shrinks with every puzzle. Note `pickWeighted` draws
  from a single bucket (swipe-binary ~70% of the time), so the effective candidate
  set is one bucket, not the whole eligible set — better than the raw window size
  implies.
- Daily / Boss: **100%**, deterministically, via the direct path — not this mechanism.

This is a property of the _algorithm_ — uniform sampling from a wide rating window —
not of the prefetch mechanism, and option (a) would not improve it by a single
percentage point. The practical consequence, stated plainly:

**Stale-while-revalidate is the load-bearing correctness path. Prefetch is a
strictly additive optimisation that pays off well for Daily and Boss (deterministic,
100%), reasonably for Rush and narrowly-filtered Practice, and barely at all for the
common unfiltered-Practice case.** Task 5 should build SWR first and make it good
enough to stand alone, rather than assuming prefetch will hide the fetch on the
default `/practice` path. It will not — roughly 96% of the time, unfiltered Practice
will miss the prefetch and fall through to SWR.

One genuinely high-value, near-deterministic target worth calling out separately: the
**requeue path**. When `lastSource !== 'requeue'` and a due entry's puzzle is in the
pool, `selectNext` will serve that specific id with certainty (`selection.ts:91-101`) —
no randomness at all. Prefetching the first in-pool due id is a ~100%-hit-rate
prefetch, available whenever the requeue ladder is non-empty. Task 5 gets this for
free from the N-call mechanism above (the first speculative call reproduces exactly
this, given the correct `lastSource`), but it is worth knowing that not all N draws
are equally speculative — draw 1 is often a near-certainty and draws 2..N are the
coin flips.
