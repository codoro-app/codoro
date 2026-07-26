# Codoro v1 — retro

v1 is done. This is the bridge to v2: what shipped, what it's actually like to use, and why v2 isn't an iteration on this app but a different kind of app.

## What shipped

| Phase                                  | Outcome                                                                                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Domain, repo, tooling, live deploy | Vite/React/TS strict scaffold, pinned toolchain, CI, `getcodoro.com` live on Cloudflare Pages from day one                                                                                      |
| 1 — Rating engine + core game logic    | Pure, 100%-covered `engine/` library: Elo rating, puzzle selection, streak, spaced-repetition requeue — zero React/DOM dependency                                                               |
| 2 — Persistence layer                  | Versioned IndexedDB storage module (`idb`), migration-tested, export/import round-trip                                                                                                          |
| 3 — Puzzle content pipeline            | Schema + validation tooling + LLM-assisted authoring script; seed set of 25 puzzles                                                                                                             |
| 4 — Practice mode UI + telemetry       | Swipe/MCQ/tap-line interactions, PostHog wiring, a full bugfix pass on drag/shuffle/overflow/scroll issues                                                                                      |
| 5 — PWA                                | Manifest, service worker, real-device install path, iOS safe-area and update-flow fixes                                                                                                         |
| 6 — Daily Puzzle                       | Deterministic daily selection, later replaced with a curated day-index calendar (append-only)                                                                                                   |
| 6.5 — Responsive shell + v2 design     | Chess.com-style rail/content shell, full token/design-system overhaul                                                                                                                           |
| 7 — Puzzle Rush                        | Timed swipe-binary mode                                                                                                                                                                         |
| 8 — Content completion + calibration   | 108 puzzles (target renegotiated from 150 — see `codoro_build_plan.md`'s Phase 8 amendment), every pattern spans ≥800 difficulty points, no empty 200pt bucket in the range new users draw from |

## The central finding — quiz vs. puzzle

The content is quiz questions about bugs, not puzzles. An MCQ where three of four options are implausible is trivia. A swipe-binary "correct or buggy?" is a coin flip with an explanation attached. Neither requires the player to _hold state and reason forward_ — and that's the thing that separates a puzzle from a quiz. Wordle is a puzzle because constraints accumulate across guesses. Codoro v1 asks one-shot recognition questions, so it plays like a flashcard deck with an Elo score bolted on.

Notably, the v1 build plan already identified the fix and deferred it: the **execution scrubber** — stepping through code state — was cut from v1 and named the "V2 flagship" (see the build plan's "Locked decisions" table, Interaction model row). That instinct was correct. v2 isn't a bigger or better version of this quiz; it's built around actually tracing execution.

## Secondary findings

From `docs/phase8-content-status.md`:

- **Difficulty curve was bimodal with a dead zone at exactly the 1200 starting rating.** New users drew only from a fat 30-puzzle easy cluster (1000–1199), then hit a wall of 1600s. Task B's four hand-authored puzzles closed the two worst gaps (concurrency, error-handling), but the underlying anchoring problem — LLM-assigned ratings clustering on round numbers instead of applying the calibration rubric — is a pipeline issue, not a one-time content fix.
- **LLM-assigned ratings anchor to round numbers.** Most of the original 104 puzzles sit at exactly 1000/1600/1700/1900; only a handful were manually re-calibrated off those round values.
- **Language mix ended up lopsided: 61% JavaScript, 23% Java, 14% Python, 2% C** — no target mix was ever set for language the way interaction type had one (45/35/20 swipe/mcq/tap-line). A Python-first user hits mostly JS puzzles.
- **108 puzzles is roughly four sessions before repeats start.** Content volume is the binding retention constraint in _any_ content format — fixing the curve doesn't fix running out of puzzles.
- **No backend meant no leaderboard, no head-to-head, no social loop.** An Elo rating nobody else can see is a number in a drawer.

## What the architecture bought — and cost

The pure-`engine` / tested-storage / content-pipeline separation was the right call: rating, streak, requeue, selection, and persistence are all decoupled from the content format and the UI. v2 can replace _what a puzzle is_ and _how it's presented_ without touching any of that — it's a rebuild of the top half of the stack, not a rewrite. The lint-enforced `engine/` boundary (no React, no `app/` imports) meant this was never at risk of quietly rotting into the UI layer.

Against that: nine phases and ~104 puzzles were built before a single external user tried the thing. The architecture is sound; the sequencing front-loaded infrastructure over validation. v2 should get _something_ in front of someone earlier, even if the content pipeline underneath it is less polished at that point.

## What was skipped in this wrap-up, and why

v1 is not being marketed and isn't expected to acquire users, so several checks from the original Phase 9 hardening checklist were deliberately skipped rather than performed:

- **PostHog growth dashboards** (day-2 return, session length, puzzles/session) — there's no cohort of real users generating this data, so dashboards would sit empty.
- **The week-long storage-survival soak test** — meaningful for catching browser eviction behavior over time under real usage; not worth a week of calendar time for an app not accepting new users.
- **The fresh-user friend walkthrough** — a qualitative check for whether a stranger can pick up the app with zero instructions; skipped because there's no one being pointed at this build.
- **Cross-device Daily verification** — checking the deterministic daily calendar resolves consistently across a user's own devices; skipped for the same reason as the soak test, no real multi-device users to check against.

All four measure adoption or longevity that isn't coming. What the reduced Phase 9 pass did actually verify — `pnpm validate` from a fresh clone (clean), and real 404/favicon/OG tag coverage (404.html and robots.txt were both missing and are now fixed) — is recorded in the build plan's Phase 9 amendment. It also surfaced findings that don't get to hide behind a checkmark: Lighthouse performance on production is 82, not the targeted 90+; production telemetry appears to have never actually been active (`VITE_POSTHOG_KEY` looks unset in the Cloudflare Pages build environment — no PostHog event has ever reached production); the export/import functions work and are unit-tested but have no UI anywhere in the app; and the service-worker-update-vs-a-real-deploy check couldn't be confirmed live in the time available. See `docs/v2-backlog.md` for the details on each.
