# First-run puzzle sequence — design record

**Date:** 2026-09-03
**Branch:** `feat/first-run-sequence` (off `origin/main`, post-merge of PR #102 —
the challenge redesign landed first, so this branches directly off `main` rather
than off `feat/challenge-redesign`, which no longer exists. Depends on that PR's
`ChallengeButton`/`useChallengerName` for its payoff screen, both already on `main`;
see `2026-09-03-challenge-redesign-design.md` for that PR's own design record.)
**Status:** Approved by Thomas — proceeding to implementation.

## Problem

Most first-time visitors bounce without really playing: `'/'` boots into Home, whose
mode cards route into the normal rating-window selector, which often serves mcq/swipe-
binary — interactions that feel like flashcards, not puzzles. `bossRun.ts`/
`useBossSession.ts` already solve this exact problem for Boss with a curated, ordered id
list instead of the live selector; this reuses that pattern for a brand-new profile's
very first three puzzles.

**Locked constraint honored:** App.tsx's 2026-08-26 decision that `'/'` always renders
Home (first-ever and returning visitors alike) is untouched. The sequence renders
**inline from Home** when the gate is true, never a redirect to a new route — Home's own
existing `profile === null` loading branch is the precedent for this kind of early
return.

## Content: `FIRST_RUN_SET`

`src/content/firstRun.ts`, ordered array of exactly 3 ids, none overlapping any
`BOSS_SETS` entry (so a first-run graduate's first Boss run doesn't immediately repeat a
puzzle they just solved):

1. `cf-002` — tap-line, 1300, control-flow (nested-loop `break` only exits the inner
   loop — single-line spot-the-bug)
2. `oob-021` — drag-order, 1150, off-by-one (4-block reorder, deliberately short — an
   8-block drag-order puzzle is too much cognitive load for someone's first-ever puzzle)
3. `dsm-016` — scrubber, 1125, data-structure-misuse (`.pop()` on a "queue" — 4
   checkpoints, self-contained)

New `validateFirstRunSet(set, valid)` in `validatePuzzles.ts`, mirroring
`validateBossRun`: exactly 3 entries, ids unique and resolve in the real pool,
interaction sequence exactly `[tap-line, drag-order, scrubber]`, each
`difficulty_rating` in `[1000, 1300]`. Wired into `validateContent.ts`'s `main()`
alongside `validateAllBossSets`. Exported from the content barrel (`content/index.ts`).

## Schema: one new field

`UserProfileSchema` gets `firstRunCompleted: z.boolean()`.

- Continuing the version chain from the challenge-redesign PR (confirmed merged —
  `CURRENT_SCHEMA_VERSION` is 11 on `main` as of this branch's base):
  `CURRENT_SCHEMA_VERSION` 11 → 12.
- `migrateV11ToV12`: `firstRunCompleted: true` for every existing (pre-migration)
  profile — an existing profile has, by definition, already had _some_ first run of the
  app; this is confirmed with Thomas as the safer default against ever re-surfacing
  onboarding to a returning visitor, even one whose recorded attempts happen to be empty
  (e.g. a cleared/imported history).
- `createDefaultProfile()`: `firstRunCompleted: false`.
- This is the **only** new `UserProfile` field this PR adds (Global Constraint honored —
  `challengerName` belongs to the other PR, already landed on the branch this one is
  stacked on).

## The gate

Home.tsx already loads `profile`/`attempts` on mount. Gate:

```ts
const showFirstRun = attempts.length === 0 && !profile.firstRunCompleted
```

When true, Home's return renders `<FirstRunSequence onComplete={(updatedProfile) => {
setProfile(updatedProfile); setShowFirstRun(false) }} />` in place of its normal JSX —
same early-return shape as the existing `profile === null` loading branch, never a
redirect. `onComplete` hands back the updated profile (already carrying
`firstRunCompleted: true`, persisted) so Home's own state stays in sync and immediately
falls through to normal Home content with no reload.

## `useFirstRunSession`

Mirrors `useBossSession`'s status machine (`loading/ready/empty/error`) and fixed-order
`serveAt(position)` — no widening, no repeat-exclusion, no rng, no dev-stub branch
beyond the standard one (`resolveFirstRunStubPuzzle(position)` added to
`devPuzzleMode.ts`, mirroring `resolveBossStubPuzzle` exactly).

Because puzzle 3 is scrubber, it also needs `useDailySession`'s split:
`handleAnswered` (puzzles 1–2, quiz commit via `PuzzleCardShell`) and
`onCheckpointAnswered`/`checkpointResults`/`isComplete`/`solved` (puzzle 3, via
`TraceRunnerPuzzle` — same branch `DailyPage.tsx` already uses for a scrubber-day
puzzle). A shared `commitAttempt` helper (same role as `useDailySession`'s) does the
actual write:

- Always `mode: 'practice'`. `shouldRateAttempt('practice', …)` is already
  unconditionally `true` in `rating.ts` — **no new rating carve-out is needed**; this
  is a normal rated Practice attempt like any other. Documented inline the same way
  `useBossSession`'s "Boss never rates" comment documents _its_ own reasoning, just the
  opposite conclusion.
- Fires the new `first_run_step_complete` event alongside `trackAttempt`:
  `{ position: 1 | 2 | 3, puzzle_id, interaction, correct }`.
- On the 3rd puzzle's commit specifically: flips `profile.firstRunCompleted = true`,
  persists it, and fires `first_run_completed`: `{ correct_count: 0-3 }`. This flips at
  **commit time**, not at the hook-screen tap — a visitor who solves puzzle 3 and closes
  the tab before seeing the payoff screen still correctly never sees first-run again.
- `handleContinue` advances position 0 → 1 → 2 → `phase: 'ended'`, identical shape to
  Boss's own `handleContinue`/`pendingEndRef` mechanics.

## `FirstRunSequence` + payoff screen

Renders via `PuzzleCardShell` (puzzles 1–2) / `TraceRunnerPuzzle` (puzzle 3) — same
dispatch `DailyPage.tsx` already uses. Once `phase === 'ended'`, renders the payoff
screen (`FirstRunComplete.tsx`):

- A real stat, not "nice job" — new rating + `{correct_count}/3`.
- Primary CTA → `/practice`, secondary link → `/daily`.
- **`ChallengeButton`** (from the challenge-redesign PR) fed the 3 puzzles' accumulated
  `ChallengeAttemptInput[]` results, `surface: 'first_run'` — the same first-class,
  always-visible component every other surface now uses, not a bespoke one-off. This is
  what makes the social loop visible in the very first session, per Thomas's explicit
  ask, without inventing a second challenge affordance just for this screen.
- Styling: `CARD_PRIMARY`/`.daily-hero`-style gradient hero, matching existing
  card/token conventions — no new visual language beyond what the challenge-redesign PR
  already introduced for `ChallengeButton` itself.

## Telemetry

- `first_run_step_complete` — fires once per puzzle position (see `commitAttempt`
  above). This is deliberate: Thomas wants to see exactly where in the 3-puzzle sequence
  people drop off, not just an aggregate before/after number.
- `first_run_completed` — fires once, at puzzle-3 commit.
- Both follow `client.ts`'s `before_send`/sanitization conventions automatically (they
  route through `safeCapture` like every other event) — no raw puzzle content beyond
  what `attempt`/`first_run_step_complete` already expose (id/interaction/correctness,
  same shape every other mode's attempt telemetry already sends).

## Testing

- `firstRun.test.ts` (mirrors `bossRun.test.ts`): ids resolve in the real
  `quizPool`/`scrubberPool`, correct interaction sequence, no `BOSS_SETS` overlap.
- `useFirstRunSession.test.ts` (mirrors `useBossSession.test.ts`'s style): drives
  position 0 → 1 → 2 → `ended`, asserts `trackAttempt`/`first_run_step_complete`/
  `first_run_completed` calls, asserts `firstRunCompleted` flips at the 3rd commit (not
  at the hook-screen tap).
- Migration test for v(N) → v(N+1) (`firstRunCompleted: true` for existing profiles).
- Home-level gate test: fresh profile (zero attempts, `firstRunCompleted: false`) →
  renders the sequence; returning/completed profile → renders normal Home; completing
  the sequence falls through to normal Home without a reload.

## Non-goals (unchanged from the original ask)

No changes to the rating engine, the normal Practice selector, or Boss. No `UserProfile`
fields beyond `firstRunCompleted` (this PR's own scope — `challengerName` is the other
PR's field, already on the branch this stacks on). No visual redesign beyond the payoff
screen and what the challenge-redesign PR already introduced. Daily's mcq/swipe-binary
exclusion and calendar untouched. No time-pressure/streak-weighting/pacing changes.
