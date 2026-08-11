# v3 Phase 2 — Missions: definition session + implementation plan

Companion to `docs/design/click-meaningfulness.md` (the definition-session deliverable itself) and `docs/v3-build-plan.md` Phase 2's amendment (2026-08-11). This is the implementation plan produced the same session, covering schema, hook design, UI, telemetry, tests, and sequencing. Not yet built — recorded here so the next session picks up from a concrete plan rather than re-deriving it.

## Storage: schema v8 → v9

`src/storage/schema.ts` (`CURRENT_SCHEMA_VERSION` at 8 today):

- `MissionStageId = 'trace' | 'speed' | 'boss'`, `MISSION_STAGE_ORDER` tuple.
- `MissionStageStats`: discriminated union on `stageId` — `trace: { puzzlesCompleted, solvedCount }`, `speed: { solvedCount, bestStreakThisRun }`, `boss: { depthReached, cleared }`.
- `MissionStageSummary`: `{ stats: MissionStageStats, endedReason: 'timer' | 'native', completedAt: string }`.
- `MissionProgress`: `{ runId, currentStage, completedStages: MissionStageSummary[], startedAt }` — nullable on `UserProfile`. Written **only at stage boundaries**, never mid-stage (this is what makes resume/abandon work with no separate detection logic — see the design doc's §3).
- `MissionStats`: `{ completions, lastRunAt, lastCompletedAt }` — nullable, null-until-first-completion, same convention as `bossStats`/`rushStats`. Deliberately minimal: no composite cross-run "best arc" scalar (would itself be an invented-number mechanic, banned by the design doc's payoff decision); flag richer cross-run stats as an explicit fast-follow, not silently dropped.
- `createDefaultProfile()`: both new fields `null`.
- `src/storage/migrations.ts`: `migrateV8ToV9` — spreads existing profile, sets `schema_version: 9`, `missionProgress: null`, `missionStats: null`. Registered at `MIGRATIONS[8]`.
- Isolated migration test (`migrations.test.ts`, calling `MIGRATIONS[8]` directly, mirroring the existing `MIGRATIONS[7]` block) + `exportImport.test.ts` round-trip fixture update + `schema.test.ts` validation coverage for the new schemas.

## `useMissionSession` + stage components

**Not** one hook calling `useTraceSession`/`useRushSession`/`useBossSession` unconditionally — that violates Rules of Hooks (can't conditionally call only the active stage's hook in one function body) and would make the two inactive hooks' mount effects (real `loadProfile`/`startRun` calls) run on every render regardless of which stage is actually active.

**Actual shape**: `MissionsPage` conditionally renders exactly one of `TraceStage` / `SpeedStage` / `BossStage` at a time, each calling exactly one real session hook directly — legal under Rules of Hooks (the component tree decides, not one function body) and gives each stage hook the same clean single-owner mount lifecycle it already has standalone. `useMissionSession` itself owns only the outer machinery: `MissionProgress` load/persist, the 60s stage clock (`missionStageClock.ts`, a pure `hasStageClockExpired(deadlineMs, now)` export, unit-testable with no fake timers, same visibilitychange-safe deadline-math pattern as `useRushSession`'s own timer), top-level phase (`'checkpoint' | 'trace' | 'speed' | 'boss' | 'complete'`), and the abandon handler + mission-level telemetry.

**Per-stage reuse**:

- **Trace**: zero changes to `useTraceSession.ts`/`TraceRunner.tsx`. `TraceRunnerPuzzle` (already exported, presentational, takes an injectable `onContinue`) is reused directly — `TraceStage` calls `useTraceSession()` and intercepts `onContinue` to check the stage clock before deciding to advance within-stage or end the stage.
- **Speed/Boss**: one small additive refactor first — extract the `'playing'`-phase JSX block from `RushPage.tsx`/`BossPage.tsx` (header/strikes/timer + `PuzzleCardShell`) into exported presentational components `RushActivePlay.tsx`/`BossActivePlay.tsx`, parameterized by the session object and an overridable `onContinue`. Pure extraction, zero behavior change — `RushPage.test.tsx`/`BossPage.test.tsx` must pass unmodified after. `SpeedStage`/`BossStage` then call `useRushSession()`/`useBossSession()` directly and render the extracted component with a mission-supplied `onContinue`.

**Native-end vs. timer-cutoff rule**: stats (`rushStats`/`bossStats`) persist only when a stage ends via its own mode's real internal `endRun` (a genuine 3-strikes/depth-10 event) — never when the mission's shared clock cuts it short first. This isn't a new rule invented for Missions: standalone Rush/Boss today _already_ never write `rushStats`/`bossStats` from a walk-away (`saveProfile` for those fields only happens inside `endRun`, only reachable from `handleContinue`'s end branch, never from unmount) — a mission timer-cutoff is functionally the same "stopped before the run naturally ended" case, just handled explicitly instead of by falling off a cliff. Per-puzzle `Attempt` rows and `attempt` telemetry are unaffected either way (already recorded unconditionally by `handleAnswered`, before Continue is ever tapped) — no content-calibration signal is lost to truncation.

**Known trade-off, stated not hidden**: per-puzzle `attempt` events aren't tagged as "played inside a mission" — analysis wanting that would join `mission_stage_complete`'s `run_id` + time window against the `attempt` stream. Flagged as a fast-follow candidate if it turns out to matter, not silently accepted.

## UI

New `src/app/missions/`: `MissionsPage.tsx` (thin shell, mirrors `TracePage.tsx`), `useMissionSession.ts`, `missionStageClock.ts`, `TraceStage.tsx`/`SpeedStage.tsx`/`BossStage.tsx`, `MissionCheckpoint.tsx` (one reusable component for first entry, every inter-stage transition, and mid-arc resume — shows completed-stage badges, next stage's icon/name/"60 seconds" preview, Start/Continue CTA, and — once `completedStages.length > 0` — a small inline "Exit mission?" confirm), `MissionComplete.tsx` (payoff screen: full arc recap, `missionStats.completions`-based badge, "Run it back" mirroring Boss's own wording — **no rating/Elo number anywhere on this screen**).

Routing: `ROUTES.missions`/`ROUTE_META['/missions']` in `src/app/routes.ts`; a lazy-loaded route entry in `src/app/App.tsx` (own code-split chunk, matching every other mode); a Missions tab in `NavRail.tsx`/`ModeSwitcher.tsx` mirroring Boss's existing entry. `Home.tsx`: a Missions card mirroring Boss's/Rush's badge pattern, reading `profile.missionStats` — flagging that `.home__cards-secondary`'s grid needs re-tuning again for a 5th card (already re-tuned once for Boss, 3→4 tracks); the build session decides between a 5th secondary card vs. more prominent placement, not locked here.

## Telemetry

`src/telemetry/events.ts` additions, matching `RushRunEndPayload`/`BossRunEndPayload`'s existing conventions: `trackMissionStart({ run_id })`, `trackMissionStageComplete({ run_id, stage, ended_reason, stats })`, `trackMissionAbandoned({ run_id, stage, completed_stage_count })`, `trackMissionFinished({ run_id, completions })`. Existing per-puzzle/per-run events (`attempt`, `rush_run_end`, `boss_run_end`) already fire unmodified from the reused hooks — verify, don't reimplement.

## Tests

- `migrations.test.ts` (isolated `MIGRATIONS[8]` block), `exportImport.test.ts` (round-trip fixture), `schema.test.ts` (new schema validation).
- `missionStageClock.test.ts` (pure function, no fake timers).
- `useMissionSession.test.ts`, mirroring `useBossSession.test.ts`'s shape: full happy path (all 3 stages via timer expiry, fake timers); native-end-before-timer for Speed/Boss (asserts stats **are** written); timer-cutoff-while-still-playing (asserts stats **are not** written — the revert-check test for the native-vs-timer branch); resume-after-reload (seeded mid-arc `missionProgress`, fresh mount, correct stage + fresh clock); explicit abandon (progress cleared, `trackMissionAbandoned` fired, no stats write).
- `MissionsPage.test.tsx`, mirroring `BossPage.test.tsx`: status branching, checkpoint screen, stage transitions, and a direct assertion that `MissionComplete`'s rendered output never contains a rating-delta-shaped token (protects the no-invented-number decision directly).
- `telemetry.test.ts` extended for the four new event functions.
- Refactor regression check (not new tests): `RushPage.test.tsx`/`BossPage.test.tsx` must pass **unmodified** immediately after the `RushActivePlay`/`BossActivePlay` extraction, before any Mission-specific code lands — proves the extraction was behavior-preserving.
- No new pool-level tests needed — Missions introduces no new content-selection logic (Trace/Rush/Boss's existing `selectNext`/`selectRushPuzzle`/`BOSS_SETS` are reused untouched); stated in the build amendment so this is visibly considered, not overlooked.

## Sequencing (session-sized, mirrors Phase 1's own granularity)

0. **Definition session (blocking)** — done, 2026-08-11. `docs/design/click-meaningfulness.md` committed.
1. **Refactor-first task** — extract `RushActivePlay.tsx`/`BossActivePlay.tsx`, zero behavior change, existing tests pass unmodified. De-risks everything downstream.
2. **Schema + migration + persistence, no UI** — v8→v9, isolated migration test, export/import round-trip, schema validation tests.
3. **`useMissionSession` core state machine** — phase transitions, boundary-only persistence, stage clock + its test, abandon handling + telemetry stub, tested against stub stages before real hook wiring.
4. **Real stage components** — `TraceStage`/`SpeedStage`/`BossStage`, the native-vs-timer branch, soft-cutoff `onContinue` interception. Highest-risk task; isolated on its own.
5. **UI + routing** — `MissionsPage`, `MissionCheckpoint`, `MissionComplete`, routes/nav entries, Home card (+ grid re-tune), component tests.
6. **Telemetry + click-meaningfulness conformance pass + final validate** — wire the four events, extend `telemetry.test.ts`, verify events fire locally, write the amendment citing which build decisions came from which section of the design doc (the DoD's explicit requirement), `pnpm validate` green.

## Verification

- `pnpm validate` green after every task (typecheck, lint, full test suite, `validate:content` untouched since no content-selection logic changes).
- Manual desktop/mobile playthrough of the full mission chain (start → all 3 stages → payoff → "Run it back"), plus an explicit resume test (start a mission, close mid-stage, reopen, confirm resume at the right stage with prior stage summaries intact) and an explicit abandon test (exit mid-arc, confirm progress clears) — Thomas's own pass, per this repo's standing build-vs-verify split.
- DoD (from `docs/v3-build-plan.md`'s Phase 2 section): design doc exists and build amendment cites which decisions came from which section; full mission chain playable end-to-end with working resume and export/import round-trip; isolated migration test; telemetry verified; `pnpm validate` green.
