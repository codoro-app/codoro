# Codoro

Codoro is a bug-spotting practice app: you're shown a short code snippet and asked to find the bug — via a swipe (correct/buggy), a multiple-choice question, or tapping the offending line. An Elo-style rating tracks your skill and picks puzzles near your level.

Live at [getcodoro.com](https://getcodoro.com) — it's a PWA, installable from the browser on desktop and mobile.

## Stack

- Vite + React 19 + TypeScript (strict)
- pnpm, pinned via Corepack
- Cloudflare Pages hosting
- IndexedDB (via `idb`) for local persistence — no backend, no accounts
- PostHog for anonymous usage telemetry

## Local dev

Prerequisites: Node version pinned in `.nvmrc`, pnpm via Corepack.

```sh
corepack enable
pnpm install
pnpm dev
```

## Scripts

| Script                  | What it does                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm validate`         | Full gate: typecheck, lint, test, content validation, build                                                                               |
| `pnpm test`             | Run the test suite (Vitest)                                                                                                               |
| `pnpm validate:content` | Validate every puzzle JSON against the content schema                                                                                     |
| `pnpm content:stats`    | Per-pattern / per-interaction-type / difficulty-histogram breakdown                                                                       |
| `pnpm generate:puzzles` | Gap-driven LLM puzzle authoring (see `src/content/GENERATING_PUZZLES.md`)                                                                 |
| `pnpm perf:lighthouse`  | Clean-profile (extension-free) Lighthouse audit of `/practice`, median of 3 runs per form factor — see `docs/perf-baseline-2026-08-24.md` |

## Architecture

- `src/engine/` — pure TypeScript: rating (Elo), puzzle selection, streak, spaced-repetition requeue. No React, no DOM, no storage — lint-enforced (`engine/` cannot import `react` or `app/`), so this logic is fully unit-testable in isolation.
- `src/content/` — puzzle data (`puzzles/*.json`), the Zod schema that validates it, and the authoring/generation tooling.
- `src/storage/` — the IndexedDB persistence layer, versioned and migration-tested.
- `src/telemetry/` — PostHog event wiring.
- `src/app/` — React UI: pages, components, hooks. Everything above is consumed here, never the reverse.

## Status

v1 is complete and not under active development. v2 is planned — see `docs/v2-build-plan.md` for the phased plan (execution-scrubber flagship, local-first, no backend) and `docs/roadmap.md` for the full arc through launch (v3), accounts (v4), and multiplayer (v5). `docs/v1-retro.md` covers what shipped and what was learned.
