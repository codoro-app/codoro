# Codoro — Phased Build Plan (V1)

**Rule of engagement:** no phase starts until you've checked off the previous phase's verification list and explicitly approved it. Each phase ends with a checkpoint.

## Locked decisions (from PRD review, 2026-07-14)

| Decision            | Choice                                                                                                                                                                           | Why                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework           | Vite + React + TypeScript (strict)                                                                                                                                               | Static SPA matching the PRD; vite-plugin-pwa (Workbox) is the mature SW path                                                                                                                                                                                                                                                                                                 |
| Package manager     | pnpm                                                                                                                                                                             | Fast, strict node_modules, lockfile catches phantom deps                                                                                                                                                                                                                                                                                                                     |
| Hosting             | Cloudflare Pages (reconsidered vs. Workers-with-static-assets on 2026-07-15, confirmed)                                                                                          | Free unlimited bandwidth, auto-HTTPS, per-branch preview deploys. Cloudflare is steering new capabilities toward Workers, but Pages remains fully supported with no forced-migration deadline, and V1 has zero backend. Revisit only when a real server-side need appears (leaderboards, anti-cheat, accounts) — Pages→Workers is a documented migration path, not a rewrite |
| Project identity    | Dedicated project Gmail (not personal, not OSU work email) + GitHub org (not personal account)                                                                                   | Clean ownership separation for future co-founder/sale/transfer; avoids any IP-assignment ambiguity with the OSU employment agreement once that starts                                                                                                                                                                                                                        |
| Toolchain pinning   | `packageManager` field in `package.json` (Corepack) + `.nvmrc`, matched exactly in CI                                                                                            | Kills "works on my machine" drift before it can start — this is Phase 0's whole purpose                                                                                                                                                                                                                                                                                      |
| Domain              | getcodoro.com — **buy it Day 1 if not already purchased**                                                                                                                        | Registrar at Cloudflare keeps DNS + hosting in one place                                                                                                                                                                                                                                                                                                                     |
| Rated modes         | Practice + Daily (first attempt only); Rush unrated                                                                                                                              | Daily retries allowed but only attempt 1 touches rating; Rush tracks best-score stats only                                                                                                                                                                                                                                                                                   |
| Telemetry           | PostHog free tier, anonymous events                                                                                                                                              | Satisfies PRD §11 attempt-level data + §9 metrics with no backend                                                                                                                                                                                                                                                                                                            |
| Storage             | IndexedDB (via `idb`) behind a storage module, **not** raw localStorage                                                                                                          | Eviction resistance, `navigator.storage.persist()`, schema versioning                                                                                                                                                                                                                                                                                                        |
| Rating constants    | Start 1200; K=32 first 20 rated attempts, then K=24; floor 400; store float, display rounded int                                                                                 | Deterministic, testable, converges new users fast                                                                                                                                                                                                                                                                                                                            |
| Puzzle selection    | ±200 rating window; widen by +100 steps if <10 eligible; no repeat within last 20 served unless pool exhausted                                                                   | Handles small pool at rating extremes                                                                                                                                                                                                                                                                                                                                        |
| Spaced repetition   | Missed puzzle resurfaces after 3, 10, 25 subsequent practice puzzles, then leaves the requeue                                                                                    | Dumbest thing that works; tune post-launch                                                                                                                                                                                                                                                                                                                                   |
| Per-pattern mastery | Rolling accuracy over last 20 attempts per pattern — **no** per-pattern Elo in V1                                                                                                | One rating system to calibrate, not thirteen                                                                                                                                                                                                                                                                                                                                 |
| Daily seeding       | Deterministic hash of user-local calendar date → puzzle index; accepted tradeoff: puzzle is readable from the bundle (Wordle-style)                                              | Zero backend; ±24h timezone skew is acceptable                                                                                                                                                                                                                                                                                                                               |
| Interaction model   | Per-puzzle `interaction` field: `swipe-binary` (Tinder-style yes/no & A-vs-B), `tap-line` (tap the buggy line in the snippet), `mcq` (tap choices, carries 3–5-option questions) | Swipe can't represent multi-choice; interaction lives in the content schema so it must be locked before authoring. Complexity slider cut; execution scrubber deferred as named V2 flagship (per-puzzle state traces multiply the content bottleneck)                                                                                                                         |

---

## Phase 0 — Domain, repo, tooling, and a live production deploy (Week 1, days 1–3)

**What & why first:** Everything here is what "zero avoidable tech debt" means in practice, plus your priority #3: a placeholder page must be live at `https://getcodoro.com` before any feature code exists. Deployment assumptions get validated when there's nothing to debug but deployment.

**Build:**

1. Buy getcodoro.com at Cloudflare Registrar (skip if already owned). Register using the dedicated project Gmail, not personal or OSU email.
2. GitHub org (tied to the project email, not your personal GitHub account) → repo inside it, `main` protected (PRs only, CI must pass).
3. Scaffold: `pnpm create vite` → React + TS. `tsconfig` strict: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Pin the toolchain immediately: add `"packageManager": "pnpm@<exact-version>"` to `package.json` (Corepack-enforced) and an `.nvmrc` with the Node version — both must match exactly what CI uses. No version drift between your machine and CI, ever.
4. Tooling:
   - ESLint flat config: typescript-eslint's `strictTypeChecked` + `stylisticTypeChecked` (stronger than plain `recommended`, matches "strict" intent) with `parserOptions.projectService: true` for typed linting — simpler and less brittle than manually wiring `project`/`tsconfigRootDir`. Plus `eslint-plugin-react-hooks`.
   - Prettier.
   - Vitest + Testing Library, test environment set to `jsdom` (not `happy-dom` — Phase 4 needs unit tests on swipe-gesture math, and jsdom's pointer/touch event handling is more complete).
   - husky + lint-staged pre-commit, scoped to **staged files only** (format + lint). Full typecheck/test suite stays in CI, not pre-commit — a slow pre-commit hook is what gets `--no-verify`'d past later, quietly defeating the gate.
5. Folder structure that enforces the architecture:
   ```
   src/
     engine/    # pure TS: rating, selection, streak, requeue — NO React imports (lint-enforced)
     content/   # puzzle data + schema + validation
     storage/   # IndexedDB wrapper, migrations, export/import
     telemetry/ # PostHog wrapper (single choke point)
     app/       # React: components, routes, hooks
   ```
   Add an ESLint `no-restricted-imports` rule so `engine/` can never import from `app/` or React. Keep `engine/` barrel-file-free — `no-restricted-imports` only catches direct imports, not re-exports through a barrel, so this is the mechanism's known ceiling; acceptable for a solo project, don't reach for `eslint-plugin-boundaries`/`dependency-cruiser` until it actually breaks down. Single package, no monorepo tooling (Turborepo/Nx/pnpm workspaces) — that solves a problem you don't have.
6. GitHub Actions CI: typecheck → lint → test → build, on every PR. Cache the pnpm store (`actions/setup-node`'s built-in pnpm cache) — uncached CI gets slower as deps grow, and slow CI is what gets ignored later.
7. Cloudflare Pages connected to the repo: `main` → production, branches → preview URLs. Custom domain `getcodoro.com` + `www` redirect. One placeholder page.
8. `.env.example` + typed env access (validate `import.meta.env` at startup); PostHog key as the first env var.

**Definition of done:**

- [ ] `https://getcodoro.com` serves the app over HTTPS with a valid cert; `www` and `http://` redirect correctly
- [ ] A PR with a type error, a lint error, or a failing test is blocked by CI (test this deliberately with a junk PR)
- [ ] Merging to `main` auto-deploys; a branch push produces a preview URL
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass locally from a fresh clone
- [ ] `package.json` "packageManager" field + `.nvmrc` present; CI's Node/pnpm versions match them exactly
- [ ] Pre-commit hook touches only staged files (verify: stage one clean file, leave a deliberate lint error elsewhere in the repo unstaged, commit should still succeed)
- [ ] pnpm store cache hit confirmed on a second CI run (check the Actions log)

**You verify:** open getcodoro.com on your phone over cellular (not wifi — catches DNS propagation issues); confirm the deliberate-failure PR was actually blocked; fresh-clone the repo somewhere else and run the four commands.

**Locks in:** pnpm, Vite, TS strict, folder architecture, CI gate, Cloudflare, project identity (email/org separate from personal). Changing any of these later is the tech debt you said you don't want — hence day 1.

---

## Phase 1 — Rating engine + core game logic as a pure, tested library (Week 1, days 3–6)

**What & why here:** The rating algorithm is the product's spine and the most unit-testable thing in the codebase. It gets built with zero UI so it can be verified exhaustively before anything visual exists. Depends only on Phase 0's test rig.

**Build (all in `src/engine/`, pure functions, no I/O):**

1. `rating.ts` — `expectedScore(userR, puzzleR)`, `updateRating(userR, puzzleR, correct, attemptCount)` implementing the locked constants (K schedule, floor, float math).
2. `selection.ts` — rating-window puzzle picker with widening fallback, recent-repeat exclusion, requeue injection. Takes the pool and history as arguments (deterministic, seedable RNG for tests).
3. `streak.ts` — local-date streak logic (increment, reset, same-day idempotence, DST/timezone edge handling via date strings not timestamps).
4. `requeue.ts` — the 3/10/25 resurface ladder.
5. `daily.ts` — date-string → puzzle index deterministic hash.

**Tests (this is the phase's real deliverable):**

- Exact-value cases: equal ratings → expected 0.5, update = ±K/2; 400-point gap → expected ≈ 0.909/0.091
- Property tests (fast-check): expected ∈ (0,1); correct answer never decreases rating; wrong never increases; rating never below floor; update magnitude ≤ K
- Convergence simulation: simulate a "true 1600" user (answers correct with probability = expectedScore against each puzzle) over 100 puzzles → rating converges to 1600 ± 75. Run for true ratings 900/1400/2000
- Selection: window widening triggers correctly at pool edges; no repeats within 20; requeued puzzles appear at the right offsets
- Streak: consecutive days increment; gap resets; two sessions same day count once; date rollover at local midnight
- Daily: same date → same puzzle, all 366 dates map into pool bounds, distribution roughly uniform

**Definition of done:**

- [ ] 100% line coverage on `engine/` (it's pure logic; anything less is untested behavior)
- [ ] Convergence simulation output committed as a readable report (you can eyeball the curves)
- [ ] `engine/` has zero imports from React, DOM, or storage

**You verify:** read the convergence report and confirm the numbers make intuitive sense; hand-compute one Elo update on paper and check it matches a test's expected value.

**Locks in:** the exact rating spec. After this phase, changing K or the floor means a deliberate versioned change, not a drive-by edit.

---

## Phase 2 — Persistence layer (Week 2, days 1–2)

**What & why here:** Storage is the PRD's riskiest decision (Flag 2 from review), so it gets its own isolated, tested layer before any UI writes data. Depends on Phase 1's types (`UserProfile`, `Attempt`).

**Build (in `src/storage/`):**

1. Zod schemas for `UserProfile` and `Attempt` with `schema_version` on the stored root object. `Attempt` includes `mode` (`practice | daily | rush`), `time_ms`, `choice_index` — non-negotiable per PRD §11's recalibration goal.
2. IndexedDB wrapper (`idb` library) exposing typed `loadProfile / saveProfile / appendAttempt / listAttempts`. No component touches IndexedDB directly.
3. Migration runner: `migrations[fromVersion]` array, runs on load, no-op today but the seam exists — this is what makes "zero tech debt" real for stored data.
4. `navigator.storage.persist()` requested on first meaningful interaction; result recorded.
5. Export/import: download profile+attempts as JSON, restore from file, with schema validation on import.
6. Corrupt-data handling: unparseable stored state → backup the raw blob, start fresh, don't crash.

**Definition of done:**

- [ ] All storage functions unit-tested against `fake-indexeddb`, including a real migration test (write v1 fixture → load under v2 schema → assert migrated shape)
- [ ] Corrupt-blob test: garbage in IndexedDB → app state resets cleanly, raw blob preserved
- [ ] Export → wipe → import round-trip preserves every field exactly

**You verify:** in a real browser dev build: create state, export, clear site data, import, confirm rating/streak restored. Then check DevTools → Application → confirm storage shows persisted where granted.

**Locks in:** stored-data schema + versioning discipline. Every future schema change is a numbered migration.

---

## Phase 3 — Puzzle content pipeline (Week 2, days 2–4; authoring continues in parallel through Week 5)

**What & why here:** The PRD correctly names content as the bottleneck. The pipeline must exist _early_ so puzzle-writing parallelizes with all remaining feature work instead of serializing after it. Depends on the Puzzle type (Phase 1) and validation tooling (Phase 0).

**Build:**

1. Puzzle format: one JSON file per puzzle in `src/content/puzzles/<pattern>/<id>.json` (per-file = clean git diffs, no merge conflicts while authoring daily). Fields per the PRD model plus `id` (stable, never reused, e.g. `tp-014`), an `interaction` discriminator, and code snippets as plain strings with a `language` field.
2. Zod **discriminated union** on `interaction`: `mcq` (2–5 choices, one `correct_choice` index), `swipe-binary` (left/right labels + correct direction), `tap-line` (snippet required, `correct_line` must be a valid line index in the snippet). Shared validation across all types: unique IDs across the pool, `difficulty_rating` ∈ [800, 2400], non-empty `explanation`, `pattern` in the enum.
3. `pnpm validate:content` — runs the schema over every file, wired into CI. A bad puzzle fails the build.
4. `pnpm content:stats` — count per pattern, difficulty histogram, **and per-interaction-type counts**, so you can see coverage gaps while authoring.
5. Build-time aggregation of puzzle files into the app bundle (Vite glob import), typed.
6. Authoring workflow doc: one template per interaction type, the difficulty-calibration rubric (what makes a puzzle 900 vs 1500 vs 2100 — write this rubric _before_ writing 150 puzzles, or your calibration will drift between week 2 and week 5). The rubric must address the binary-guess problem explicitly: a swipe-binary puzzle has a 50% guess floor, so its difficulty rating reflects "how often does someone who _knows_ the material get it right" — calibrate them harder-than-they-look or the Elo signal washes out.
7. Target interaction mix (guideline, not law): ~45% swipe-binary (they're fastest to author and power Rush), ~35% mcq, ~20% tap-line. Every pattern needs at least a few swipe-binary puzzles or Rush runs dry for that pattern.
8. **Seed set: 25 real puzzles** — ~2 per pattern, spread across difficulties, **covering all three interaction types**. Enough to build and feel the UI honestly.

**Definition of done:**

- [ ] A puzzle with a duplicate ID, out-of-range difficulty, missing explanation, or an invalid `correct_line` (tap-line) fails `validate:content` in CI (test each deliberately)
- [ ] 25 validated puzzles in the repo spanning all three interaction types; stats report renders with per-type counts
- [ ] Calibration rubric written and committed, including the binary-guess-floor rule

**You verify:** author one puzzle of _each interaction type_ end-to-end from its template and time each — those numbers × the target mix are your real content budget. If the blend averages 20+ minutes each, that's ~60 hours of authoring; adjust the launch count or the weekly schedule now, not in week 5.

**Locks in:** puzzle file format and ID scheme (IDs are referenced by attempt history — they're forever).

---

## Phase 4 — Practice mode UI + telemetry (Week 2 day 5 – Week 3 day 4)

**What & why here:** First UI phase, deliberately after engine/storage/content exist so the UI is a thin shell over tested logic. Practice is first among modes because it _is_ the core loop — Daily and Rush are wrappers around the same puzzle-card flow.

**Build:**

1. Shared puzzle-card shell: prompt, syntax-highlighted snippet (Shiki or prism — pick by bundle size), immediate correct/wrong feedback, explanation reveal, rating delta animation (+12 / −9). Interaction body renders by puzzle `interaction` type:
   - **`swipe-binary`** — Tinder-style card with drag physics (`@use-gesture/react` + `framer-motion`): card tilts and previews the answer label as you drag, springs back below threshold, flies off on commit. **Threshold tuning is a correctness feature, not polish** — commit requires distance _and_ velocity so an accidental flick can't tank a rating. Tap-the-side works as a fallback for desktop.
   - **`tap-line`** — every snippet line is a tap target with a pressed state; tapping commits; correct line highlights green / chosen-wrong line red with the real bug line then revealed.
   - **`mcq`** — tappable choice list (the baseline).
2. Game feel ("retains attention" is a requirements line, so treat it as one): spring physics on all card transitions, a visible combo counter for consecutive correct answers in-session, haptic tick on answer via `navigator.vibrate` (Android only — iOS Safari doesn't expose it; degrade silently), optional sound off by default. Cheap, high-retention-leverage, and all of it reuses in Rush.
3. Practice flow: rating-matched "next puzzle" via the Phase 1 selector; browse-by-pattern entry point.
4. Per-pattern mastery view (rolling accuracy from stored attempts).
5. Mobile-first layout — design at 375px width, verify it also reads fine at desktop. Swipe zone and tap targets thumb-reachable. This is the "in line for coffee" test.
6. PostHog integration behind `src/telemetry/`: `attempt` event (puzzle_id, correct, time_ms, mode, **interaction type**, user_rating_before/after), `session_start`. Anonymous ID only; no PII. Graceful no-op if blocked by ad-blockers (many of your target users run them — expect real event undercount, that's fine).
7. Error boundary + a lightweight error event to PostHog (decide here whether Sentry earns its bundle weight; PostHog error capture is likely enough for V1).

**Definition of done:**

- [ ] Full loop works on a preview deploy: land → solve → see explanation → rating updates → next puzzle serves near new rating
- [ ] All three interaction types playable end-to-end with the seed content
- [ ] Swipe threshold test on a real phone: 20 deliberate swipes all commit, 10 lazy half-drags all spring back — zero false commits
- [ ] Attempts and profile persist across a full browser restart
- [ ] Events visible in PostHog dashboard from the preview URL with correct payloads including interaction type
- [ ] Component tests for each interaction's answer flow (commit → feedback → explanation → next), including drag-threshold logic as a unit test on the gesture math

**You verify (on your real phone, from the preview URL):** solve 10+ puzzles mixing all three types and pay attention to friction — swipe feel, tap targets, snippet readability, scroll-vs-drag conflicts (a vertical-scrolling page with horizontal-drag cards needs `touch-action` handled right; this is where it'd surface). Get one friend to do the same without instructions. Check their events landed in PostHog. Deliberately answer wrong and confirm the requeued puzzle resurfaces 3 puzzles later.

**Locks in:** telemetry event schema (keep it stable — it's your longitudinal dataset), gesture/animation stack (`@use-gesture/react` + `framer-motion`), syntax highlighter, component patterns.

---

## Phase 5 — PWA: manifest, service worker, real-device installs (Week 3, days 4–6)

**What & why here:** After there's a real app to install, but a full two weeks before launch — so install/update problems surface while there's slack to fix them. Depends on Phase 4 (something worth installing) and Phase 0 (production HTTPS, a hard PWA requirement, already proven).

**Build:**

1. `vite-plugin-pwa`: manifest (name, short_name, theme colors, maskable icons at 192/512), generated Workbox service worker.
2. **Caching strategy — the decision that matters:** precache the app shell + puzzle content (it's bundled), `autoUpdate` registration with an in-app "Update available — refresh" prompt. Never serve a stale shell silently; a botched SW cache is the classic way to brick your own deploys for existing users.
3. iOS install path: no `beforeinstallprompt` on iOS — add a dismissible "Add to Home Screen" instruction sheet (detect iOS Safari, show Share → Add to Home Screen steps).
4. Offline: app fully usable offline post-install (all state is local — this should come nearly free; verify it actually does). Telemetry queues and flushes on reconnect (PostHog handles this; confirm).

**Definition of done:**

- [ ] Lighthouse PWA/installability checks pass on **production** getcodoro.com, not localhost
- [ ] Installs from production onto a real iPhone (Safari) and a real Android (Chrome), launches standalone without browser chrome, correct icon and splash
- [ ] Airplane-mode test on the installed app: solve puzzles, rating updates, close/reopen — everything works
- [ ] Update flow test: deploy a visible change, reopen installed app, confirm the update prompt appears and refresh gets the new version — **do not skip this one**

**You verify:** the update-flow test personally, twice. Also: install, use it, leave it untouched for a week of real calendar time while later phases proceed, then reopen and confirm rating/streak survived — this is the live check on the iOS storage-eviction risk from the PRD review, and my knowledge of current Safari eviction behavior is uncertain enough that only this test settles it.

**Locks in:** SW update strategy and manifest identity (changing app identity after users install is messy).

---

## Phase 6 — Daily Puzzle (Week 4, days 1–2)

**What & why here:** First mode wrapper. Before Rush because it carries the launch-critical retention/virality mechanics (streak + share). Depends on Practice's puzzle card, `daily.ts` (Phase 1), and streak logic.

**Build:**

1. Daily flow: today's puzzle via the deterministic date hash; **first attempt is rated** (per your decision), retries allowed after but unrated; completion state persists for the day (no re-taking for a better share).
2. Streak wiring: completing the Daily maintains/increments the streak (decide and document: does Practice-only activity also count, or Daily-only? Recommend Daily-only — it's the habit anchor; chess.com and Wordle both anchor streaks to the daily unit).
3. Share card: clipboard text, Wordle-style — `Codoro Daily #37 — ✅ first try — 🔥 12-day streak — getcodoro.com`. Emoji-grid-adjacent, no spoilers.
4. OG meta tags so the shared link unfurls properly in Discord/Slack/iMessage — your launch channels; a bare link with no preview costs real clicks.

**Definition of done:**

- [ ] Same calendar date → same puzzle across devices/browsers; completion state survives restart; can't re-take today's for rating
- [ ] First attempt moves rating; retries don't (unit-tested at the engine boundary)
- [ ] Streak increments across a real (or clock-shifted) day boundary and resets after a skipped day — test by changing device date
- [ ] Share text pastes correctly on iOS and Android; link unfurls with image in Discord and iMessage

**You verify:** complete the Daily on two devices, confirm identical puzzle; shift device clock forward a day, confirm new puzzle + streak increment; forward two days, confirm streak reset. Paste a share into a real Discord.

**Locks in:** streak semantics and the share format (users will screenshot it — treat it as public API).

---

## Phase 7 — Puzzle Rush (Week 4, days 3–5)

**What & why here:** Last mode — purely additive session loop over existing components, touches no rating logic (unrated per your decision). Nothing depends on it, so it absorbs schedule slip without endangering launch.

**Build:**

1. Rush loop: continuous serving with escalating difficulty (start ~ user rating − 400, step up per correct — mirrors chess.com's ramp), 3 strikes ends the run. Serving weighted toward `swipe-binary` puzzles (~70%) — rapid flick-sorting under pressure is the mode's whole feel; mcq and tap-line mix in as pace-breakers.
2. Strike indicator, running count, end-of-run card: solved count, best streak within run, longest-ever, per-run share text.
3. Rush history persisted (best score is a retention hook); `mode: rush` attempts still logged to storage + PostHog (calibration data, even though unrated).
4. Guard: Rush attempts must be provably excluded from rating updates (a unit test, not a code-review promise).

**Definition of done:**

- [ ] Full run: 3 wrongs end it, summary correct, best score persists and displays
- [ ] Unit test proving Rush attempts never call the rating update path
- [ ] Rush attempts appear in PostHog with `mode: rush`
- [ ] Difficulty ramp feels right at low and high starting ratings (play-test both by temporarily overriding your rating)

**You verify:** play 5+ full runs on your phone. The mode lives or dies on feel — pace of serving, whether 3 strikes arrives too fast at your rating. Note your rating before/after and confirm it didn't move.

---

## Phase 8 — Content completion + calibration pass (parallel from Phase 3; converges Week 5)

**What & why:** Not a sequential phase — a parallel track with a convergence checkpoint. The pipeline (Phase 3) exists precisely so this never blocks engineering.

**Cadence:** ~30-35 puzzles/week from Week 2 (Phase 3's timing test tells you if that's realistic — renegotiate the 150 target early if not; 120 well-calibrated puzzles beat 200 rushed ones).

**Convergence checkpoint (Week 5):**

- [x] ≥108 puzzles, all passing `validate:content`
- [x] Every pattern ≥8 puzzles; every pattern spans at least an 800-point difficulty range (stats report proves it)
- [ ] Self-review pass over every explanation — the explanation _is_ the educational product; a wrong one is worse than no puzzle
- [ ] Calibration spot-check: 15 random puzzles re-estimated blind against the rubric, ≥12 within ±200 of their assigned rating

**Amendment (2026-07-26):** The ≥150 target above is renegotiated down to ≥108, invoking this phase's own guidance to renegotiate the target early rather than rush volume. During v1 wrap-up, the content format itself was judged to be quiz questions about bugs — one-shot recognition (pick the right MCQ choice, tap the right line, swipe the right direction) — rather than puzzles that require holding state and reasoning forward across steps. Given that, generating another 40+ puzzles in the same format had no expected return: more quiz questions would not have made v1 more fun, only longer, and the API budget was better saved for v2. The curve-shape requirements were still met in full — every pattern ≥8 puzzles, every pattern spanning ≥800 difficulty points, no empty 200-point bucket in the 800–2199 range new users actually draw from — closed by hand-authoring 4 puzzles rather than an API generation run. See `docs/phase8-content-status.md` for the gap analysis this closed and `docs/v1-retro.md` for the fuller quiz-vs-puzzle discussion.

**You verify:** have one friend at a different skill level do 20 mixed puzzles and tell you which difficulty labels felt wrong. Two data points beat zero.

---

## Phase 9 — Pre-launch hardening + checklist (Week 5 → launch)

**What & why:** Final gate before posting publicly. Everything here is verification, not features. Feature freeze at the start of this phase.

**Checklist:**

_Correctness & data_

- [ ] Full regression of every prior phase's "you verify" list on production, on both real phones
- [ ] Export/import round-trip on production
- [ ] The week-long storage-survival test from Phase 5 has actually elapsed and passed
- [ ] Fresh-user walkthrough: incognito → getcodoro.com → solving a puzzle within ~10 seconds, zero instructions needed (the PRD's core promise)

_Deployment & PWA_

- [ ] Lighthouse on production: PWA installable, performance 90+, a11y 90+
- [ ] SW update flow re-verified against a real deploy
- [x] 404 handling, favicon, apple-touch-icon, OG tags on every route

_Measurement_

- [ ] PostHog dashboards prebuilt for §9's metrics: day-2 return, session length, puzzles/session — built _before_ launch so day-1 data lands somewhere useful
- [ ] Error events flowing; you know where you'd

**Amendment (2026-07-26) — reduced pass for v1 wrap-up, not a launch:** v1 is not being marketed and isn't expected to acquire users, so this phase ran reduced. Real findings, not just checkmarks:

- **404/favicon/apple-touch-icon/OG tags** — ticked. Favicon, apple-touch-icon, and a full OG/Twitter tag set were already correct. `/robots.txt` and truly-missing-path requests were both silently 200ing with the SPA shell instead of a real 404 (Cloudflare Pages' default SPA fallback, no `404.html` existed) — fixed with `public/404.html` + `public/robots.txt`. Also added a missing `<meta name="description">` and fixed `<title>codoro</title>` to match the branding used everywhere else. "Every route" is one route — this app has no URL router (`AppMode` is in-memory client state only).
- **Lighthouse on production** (real numbers, not ticked — performance target not met): performance **82** (target 90+), accessibility **94** (meets 90+), best-practices 100, SEO 82 (untargeted, measured anyway). PWA installability isn't a scored category in Lighthouse 12+ anymore; manually confirmed instead — valid manifest (name, icons at 192/512 + maskable, `display: standalone`), registered service worker, HTTPS. Performance gap (LCP/FCP ~3.1-3.9s, ~460ms render-blocking resources, ~58KB unused JS) logged to `docs/v2-backlog.md` rather than chased under time pressure.
- **Export/import round-trip** — not ticked. The underlying functions (`src/storage/exportImport.ts`) work and are unit-tested, and were live-checked against a real browser's IndexedDB on production during this pass. But there is no UI anywhere in the app that calls them — a real user cannot currently export or restore their data. Logged to the backlog; not built this pass (new UI is out of scope for this wrap-up).
- **Error events flowing** — not ticked. Found that production telemetry has likely never been active: `VITE_POSTHOG_KEY` appears unset in the Cloudflare Pages build environment (no PostHog network requests, no PostHog localStorage keys, and the `posthog-js` SDK is absent from every deployed JS chunk). Being fixed directly against the live Cloudflare project, outside this repo's PRs.
- **SW update flow vs. a real deploy** — not ticked. Several PRs merged during this pass should have triggered a production redeploy; polling `getcodoro.com` for a new bundle hash for several minutes during this session didn't show one landing, so this couldn't be confirmed live in the time available.
- **Explicitly skipped, not attempted**: the full phone regression, the week-long storage-survival soak, and the fresh-user walkthrough. All three measure adoption or longevity this app isn't getting right now. See `docs/v1-retro.md` for the reasoning.
