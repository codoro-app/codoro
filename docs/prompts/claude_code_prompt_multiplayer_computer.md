# Claude Code prompt: Multiplayer tab — Computer + Human

## Framing, read first

This is NOT a new competitive engine. It's a new _front door_ onto the one that already shipped in PR #112 (ghost race on `/challenge`). Confirm this before writing a line of code by reading:

- `src/challenge/schema.ts` — `ChallengePayload` (`{ v, ids, results: {correct, time_ms}[], totalMs, challengerName }`) and `MAX_CHALLENGE_PUZZLES`. This is the whole data model a "duel" needs. It doesn't care whether `results` came from decoding a URL fragment or from code generating them in memory.
- `src/app/challenge/challengeOutcome.ts` — `resolveChallengeOutcome`: correct-count-first, total time as tiebreak. Reuse this verbatim for both Computer and Human results.
- `src/app/challenge/ChallengeComparison.tsx` — the end-of-run result screen. Takes `theirs: ChallengePayload` + `yours: readonly ChallengeAttemptInput[]`, renders the verdict and stats line. The "not always correct" opponent behavior you're building already exists in this component and in `GhostBar`/`useGhostRace` — they already branch on `results[i].correct`. You are not inventing bot fallibility logic from scratch; you're generating a `ChallengePayload` whose `results` were simulated instead of played.
- `src/app/challenge/GhostBar.tsx` + `useGhostRace.ts` — per-puzzle live race bar during play, already reads a payload's `results[puzzleIndex]`.
- `src/app/challenge/useChallengeSession.ts` — the session hook driving `/challenge`'s play loop; study its shape (exposes `servedAt`, accumulates `ChallengeAttemptInput[]`) as the model for this feature's own session hook, but don't import it directly — it's wired to a URL-decoded payload; you need a variant that accepts a payload from either a decode step or a generator.
- `docs/superpowers/plans/2026-08-10-boss-challenges.md`, Tasks 5–6 — the exact checklist for registering a new top-level route/nav entry in this codebase (`routes.ts`, `App.tsx` lazy route, `public/_redirects`, the SW `navigateFallbackDenylist` regex in `vite.config.ts`, `Icons.tsx`, `NavRail.tsx`, `ModeSwitcher.tsx`). Follow the same pattern for `/multiplayer`.

Product decisions already made, don't re-litigate:

- **Level = a target rating band**, not a curated puzzle set. Reuse whatever selection function Practice already uses to draw puzzles for a player's live rating — find it (likely in `src/engine`, used by `usePracticeSession`) and parameterize it by an explicit target rating instead of the profile's own rating. No new content authoring.
- **5 puzzles per run**, matching `MAX_CHALLENGE_PUZZLES` exactly — reuse the constant, don't fork it.
- **Purely additive.** Nothing about today's post-puzzle share/challenge buttons changes. `/multiplayer` is a new entry point on top of the existing system, not a replacement for it.
- **Unrated, storage-free** — same stance as `/challenge` itself (see `ChallengeComparison.tsx`'s own doc comment: "`useChallengeSession` is deliberately storage-free"). A Computer or Human-via-Multiplayer run does not write to `appendAttempt`/rating. If this needs revisiting later (e.g. Computer-mode telemetry to calibrate difficulty), that's a separate follow-up, not this task.

## Scope

### 1. `/multiplayer` route + nav entry

New top-level mode, sibling to Practice/Daily/Rush/Boss/Trace. Landing page (`src/app/multiplayer/MultiplayerPage.tsx`) shows two options:

- **Computer** — a level picker (4 bands, e.g. Rookie/Solid/Sharp/Expert mapped to target ratings — pick real numbers off the existing rating scale, don't invent a new one), then starts a 5-puzzle run racing a synthetic opponent.
- **Human** — short copy explaining matchmaking isn't available yet ("send a link to a friend instead"), with a CTA that starts the same kind of 5-puzzle run (drawn from a sensible default rating band — the player's own live rating if signed in/has one, else a mid band) with **no synthetic opponent** — at the end, surface the existing challenge-share CTA (`ChallengeButton`, already built, already takes `attempts: readonly ChallengeAttemptInput[]`) so the player can send their just-played run as a real challenge link. This is not new challenge-creation logic — it's the existing post-run share flow, just reached from a new place.

Register the route everywhere Boss's plan shows it must go (see the read-first list above) — new icon in `Icons.tsx` (something vs./duel-shaped, matching the house stroke style already used by every other icon in that file), nav entries in both `NavRail.tsx` and `ModeSwitcher.tsx`.

### 2. Synthetic opponent generator — `src/multiplayer/generateComputerOpponent.ts` (new)

```ts
export function generateComputerOpponent(
  puzzles: readonly Puzzle[], // the 5 puzzles this run drew, in play order
  level: ComputerLevel, // one of the 4 bands
): ChallengePayload
```

- For each puzzle, simulate `{ correct: boolean, time_ms: number }`:
  - Correctness probability scales with the level (a fixed table, e.g. Rookie ~65%, Solid ~78%, Sharp ~88%, Expert ~96% — pick real numbers, document them as placeholders, don't pretend they're calibrated).
  - Time drawn from a distribution anchored to the puzzle's own `difficulty_rating` and the level (higher level = faster; wrong answers should generally NOT be instant — a bot that "fails" a puzzle in 200ms reads as broken, not fallible; give incorrect attempts a plausible dwell time too).
  - **Explicitly named placeholder, in a doc comment on this file**: the plan is to eventually source this from a real average-solve-time-by-Elo-and-puzzle distribution once there's enough attempt data to compute one (this is exactly the kind of aggregate `workers/src/db.ts`'s `scores`/`scores_best` tables could eventually feed, once v5 Phase 5.3 exists — not now, just leave the seam visible).
- `challengerName`: something like `` `Computer · ${levelLabel}` ``, not a real name — the recipient-facing copy in `ChallengeComparison`/`GhostBar` already falls back sensibly when this is non-null.
- `totalMs`: sum of the simulated `time_ms`, matching the schema's own invariant.
- **Determinism for tests**: accept an injectable RNG (default `Math.random`), same convention this repo already uses wherever it needs test-controlled randomness — check `src/engine`/`src/content` for the existing pattern rather than inventing a new one.

### 3. Session hook — `src/app/multiplayer/useMultiplayerSession.ts` (new)

Model directly on `useChallengeSession.ts`'s shape (serve puzzle → accept answer → accumulate `ChallengeAttemptInput[]` → end), but:

- Puzzle set comes from the live Elo-band draw (Computer) or default-band draw (Human) — never from a decoded URL.
- For Computer runs only: also carry the synthetic `ChallengePayload` from step 2, and feed `results[puzzleIndex]` into `GhostBar`/`useGhostRace` exactly as `/challenge` already does — same components, same props, no fork.
- For Human runs: no ghost bar at all (nothing to race against yet) — just an ordinary timed run, same UI weight as Practice.
- On completion: Computer runs show `ChallengeComparison` (or a close variant — the counter-challenge CTA doesn't make sense against a bot, so either suppress `ChallengeButton` there or relabel it "Challenge a friend to beat this level"); Human runs show a simpler "run complete" screen whose primary CTA is the existing `ChallengeButton` flow.

### 4. Tests

- `generateComputerOpponent.test.ts`: correctness rate and time distribution roughly match the level table (statistical assertions with a fixed seed, not exact-value assertions); `totalMs` always equals the sum of `results[].time_ms`; output validates against `ChallengePayloadSchema`.
- `useMultiplayerSession.test.ts`: mirrors `useChallengeSession.test.ts`'s structure — puzzle sequencing, attempt accumulation, run-end transition.
- Route/nav tests: same pattern as Boss's Task 5/6 tests (`routes.test.ts`'s SW-denylist-mirror and `_redirects` drift guards, `NavRail`/`ModeSwitcher` navigation tests, `Icons.test.tsx`'s `it.each` table).
- `MultiplayerPage.test.tsx`: level picker renders all 4 bands; Human path shows the "matchmaking not yet available" copy and does not render a ghost bar during play.

## DoD

- [ ] `/multiplayer` registered in every file Boss's route-registration task touched (routes.ts, App.tsx, `_redirects`, SW denylist, Icons.tsx, NavRail.tsx, ModeSwitcher.tsx)
- [ ] Computer path: 4 levels selectable, each draws a real 5-puzzle set from the existing Elo-band selection logic (no hardcoded/curated set)
- [ ] Synthetic opponent's `results` validate against `ChallengePayloadSchema`; correctness/time placeholders documented as placeholders, not asserted as calibrated
- [ ] Ghost bar renders during a Computer run using the existing `GhostBar`/`useGhostRace` components, unmodified
- [ ] End-of-run verdict for Computer uses `resolveChallengeOutcome` unmodified
- [ ] Human path shows the not-yet-available note, runs an unrated 5-puzzle set with no ghost bar, and surfaces the existing `ChallengeButton` share flow at the end
- [ ] No new writes to `appendAttempt`/rating from either path (storage-free, matching `/challenge`'s own stance)
- [ ] `pnpm validate` green

## Explicitly out of scope this session

Real matchmaking (that's the whole reason for the "not yet available" note). Calibrated bot difficulty from real telemetry (placeholder table is fine, flagged as such). Any change to today's existing post-puzzle share/challenge CTAs — this is additive only.
