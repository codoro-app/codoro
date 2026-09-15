# Claude Code prompt — OG card (v5 Phase 5.4 pulled forward) + ghost race

Run this on Sonnet. Three pieces of work, in order, each its own PR. Do not start piece 2 until piece 1 is merged; piece 3 is optional and gated on a stop-and-ask below.

## Context you must read first

- `docs/roadmap.md` (version numbering — v5 = accounts, v7 = multiplayer).
- `docs/v5-build-plan.md`, especially Phase 5.4 "Edge OG meta injection". **This work IS 5.4, pulled forward** before 5.0. Say so in every PR description.
- `docs/superpowers/plans/2026-09-08-og-card-email-list-plan.md` — read the "critical architecture note" and Part A **only**. Parts B (email list) and C (interim privacy page) are **cut** — do not build them, do not create `/privacy`, do not touch Resend. If anything in that file contradicts this prompt, this prompt wins.
- `src/challenge/schema.ts`, `src/challenge/codec.ts`, `src/app/ChallengeButton.tsx`, `src/app/challenge/ChallengePage.tsx`, `src/app/challenge/useChallengeSession.ts`, `src/app/challenge/ChallengeComparison.tsx`.
- `src/telemetry/client.ts` — note it already strips query string and hash from `$current_url` on every event. That is why the `?og=` param below needs no analytics disclosure. Do not change that behaviour.
- `index.html` lines ~29–60 (the static `og:*`/`twitter:*`/`<title>` tags the Pages Function rewrites).

Decisions already made by Thomas — do not re-open, do not ask again:

- The `?og=` query param carries **only** `{ n: challengerName | null, c: puzzleCount }`. Not `totalMs`, not puzzle ids, not results. The fragment keeps the full payload untouched.
- Text-only card. No per-challenge OG image, no Satori/workers-og.
- Codec, schema, and the fragment flow are not modified except for the purely additive `og` helpers.

## Piece 0 — docs housekeeping (do this first, one small PR)

1. `git fetch`, then rebase the two commits on `docs/v5-backend-security-amendment` (`d189740`, `27abb88`) onto current `main`. They are docs-only: `docs/v5-build-plan.md`, `docs/superpowers/plans/2026-08-27-v5-accounts-implementation-plan.md`, the new `docs/superpowers/plans/2026-08-31-v5-phase-5.0-coding-plan.md`, and `docs/runbooks/posthog-activation.md`. The branch is stale against main by ~8 days, so `git diff main` looks enormous — that is main moving, not the branch. Only those four files should change in the PR. If the rebase touches anything else, stop and say so.
2. In the same PR, apply two amendments Thomas decided 2026-09-08, as dated notes under the relevant sections (don't rewrite history, append):
   - **2FA is dropped from v5.** Clerk stays on Hobby (free). Phase 5.1 builds sign-in/sign-up with Clerk's hooks (`useSignIn`/`useSignUp`), not the prebuilt components, so Hobby's mandatory branding does not apply. Add a one-line verification task to 5.1: confirm on Clerk's current pricing page that hook-based custom flows carry no branding requirement before locking the approach.
   - **CodeRabbit Pro seat is cut.** Free tier (PR summaries) + `pnpm audit` in CI + Dependabot + secret scanning. Update the C-bis cost table: v5 ≈ $5/mo (Workers Paid) until 5.5.
   - Also append to Phase 5.4: "Pulled forward and shipped pre-5.0 on 2026-09-08 — see PR #<n>. Only `/challenge` covered; per-puzzle `/puzzle/:id` OG remains in 5.4 proper."
3. Do not touch `docs/todo.md` items 15/16 — the interim privacy page is not being built.

## Piece 1 — dynamic OG card for `/challenge` (v5 Phase 5.4, `/challenge` only)

### Stop-and-ask before writing code

- **Confirm the deploy target.** There is no `wrangler.toml` and `.github/workflows/ci.yml` does not deploy, so production is presumably a Cloudflare **Pages** project on Git integration. A `functions/` directory only works on Pages. Ask Thomas to confirm it is Pages (not Workers static assets) before creating `functions/`. If it is Workers static assets, stop — the interception pattern is different and the plan needs a paragraph, not a guess.
- Confirm final copy for the two card variants (defaults below) before the PR is marked ready.

### Build

1. `src/challenge/codec.ts` — add `buildChallengeOgParam(challengerName: string | null, puzzleCount: number): string` and `decodeChallengeOgParam(encoded: string): { n: string | null; c: number } | null`. Own small zod schema in `schema.ts` (`c` is a positive int ≤ `MAX_CHALLENGE_PUZZLES`; `n` is `string | null` with the same length cap `challengerName` already has). Same base64url helpers, same "any failure collapses to `null`" contract as `decodeChallengePayload`. `buildChallengeUrl` gains the `?og=` param **in front of** the existing fragment; nothing else about the URL changes. Every existing codec/schema/session test must pass unmodified — if one needs changing, you've changed something you shouldn't have.
2. `functions/challenge.ts` (new — this is new infra, say so in the PR):
   - `onRequestGet`: `const res = await env.ASSETS.fetch(request)`. If there's no `og` param or it fails to decode, return `res` untouched.
   - Otherwise run `HTMLRewriter` over `res` and replace the `content` attribute of `meta[property="og:title"]`, `meta[property="og:description"]`, `meta[name="twitter:title"]`, `meta[name="twitter:description"]`, and the text of `<title>`. Also set `og:url` to the request URL **without** the query string (so the canonical stays clean). Leave `og:image`/`twitter:image` alone.
   - Default copy — named: title `"{name} challenges you — {c} puzzles"`, description `"Beat {name}'s time on {c} coding puzzles. No account needed."`. Anonymous: title `"A friend challenges you — {c} puzzles"`, description `"Beat their time on {c} coding puzzles. No account needed."`. Singular when `c === 1`. The name is attribute-escaped by HTMLRewriter's `setAttribute`; still, cap it and strip control characters defensively.
   - Add `Cache-Control: no-store` on rewritten responses only (the untouched pass-through keeps whatever Pages set).
3. `src/app/ChallengeButton.tsx` — pass `challengerName` and `payload.ids.length` through to the URL builder. Should be a few lines; the data is already at the call site.
4. Tests:
   - `codec.test.ts`: encode/decode round trip, null name, `c` out of range → null, garbage → null, URL contains both `?og=` and `#`, and the fragment decodes exactly as before.
   - The Pages Function: add `wrangler` as a devDependency and a `vitest` test that runs the rewriter against a fixture copy of `index.html`'s head. If `HTMLRewriter` isn't available in the vitest environment, isolate the handler-element logic into a pure function you can test and keep the `HTMLRewriter` wiring thin. Do not skip this because it's awkward.
   - Add `pnpm dev:pages` (`wrangler pages dev dist --compatibility-date=<today>`) to `package.json` so the function can be exercised locally after `pnpm build`.
5. PR description must state plainly: (a) this is v5 Phase 5.4 pulled forward, (b) `functions/` is new infra though it touches no D1/Clerk/auth, (c) the tradeoff being made — the challenger's display name and puzzle count are now visible to Cloudflare's edge in the query string, which `codec.ts`'s original "nothing reaches the server" comment deliberately avoided; puzzle ids and results still never leave the fragment. Update that doc comment in `codec.ts` to say the same.

### Done-when

- A named challenge link unfurls in iMessage/Slack/Discord with the name and count; an anonymous one uses the "A friend" copy; a link with a mangled `og` param shows today's generic card. Thomas verifies with real debuggers (Slack, Discord, opengraph.xyz) — list the URLs you tested in the PR.
- All pre-existing tests pass untouched; `pnpm validate` is green.

## Piece 2 — ghost race on `/challenge` (client-only, no infra)

### Stop-and-ask first

Show Thomas a 5-line description of the interaction and get a yes before building. The point is to make the async challenge _feel_ live; if the design below doesn't read that way to him, iterate on paper, not in code.

### Build

The fragment payload already carries the challenger's `results[i].time_ms` per puzzle in play order. On the recipient's side (`useChallengeSession` + `ChallengePage`), for the current puzzle `i`:

- Show a thin **ghost bar** above the puzzle: fills from 0 → 100% over exactly `results[i].time_ms` from the moment the recipient's own `time_ms` clock starts (reuse that same start signal — do not add a second timer source). Label it with the challenger's name (or "Friend") and their time, e.g. `Alex · 12.4s`.
- When the bar completes before the recipient answers, it flips state: label becomes `Alex finished` and the bar turns the existing "danger" token colour. No sound, no modal, nothing that blocks input.
- When the recipient answers first, the bar freezes and shows the margin (`+3.1s ahead`). Keep the copy tiny.
- If the challenger got that puzzle wrong (`correct: false`), the ghost bar still runs on their time but the label says `Alex missed this one` when it completes — beating an incorrect answer is a real outcome the comparison screen already models.
- Respect `prefers-reduced-motion`: no animated fill, just the label and a static state change.
- `ChallengeComparison.tsx` is unchanged; it already does the end-of-run comparison.
- Telemetry: none new. Do not add events for the ghost bar.

Tests: a hook-level test that the ghost state transitions (`running` → `finished` / `beaten`) on the right timestamps with fake timers; a render test that the bar is absent when there's no payload result for the index.

### Done-when

- Playing a challenge shows the ghost for every puzzle, the states flip correctly, reduced-motion works, and nothing about scoring or the comparison screen changes.

## Rules of engagement (all pieces)

- One PR per piece, each independently revertable. Piece 1 and Piece 2 do not share a branch.
- No new runtime dependencies in the client bundle. `wrangler` is dev-only.
- Do not create `/privacy`, do not add Resend, do not add KV, do not add an email input anywhere. If you find yourself needing any of those, you've drifted into the cut scope — stop.
- `docs/todo.md` is gitignored scratch; annotate in place if relevant, never delete.
- Stop and ask on anything in the stop-and-ask lists above rather than guessing.
