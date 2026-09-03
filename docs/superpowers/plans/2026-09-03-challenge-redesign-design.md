# Challenge redesign — design record

**Date:** 2026-09-03
**Branch:** `feat/challenge-redesign` (off `origin/main`)
**Mockups:** https://claude.ai/code/artifact/571fe245-2052-44f9-b588-2899c007725a
**Status:** Approved by Thomas — proceeding to implementation.

## Problem

Two real gaps, both raised directly by Thomas after reviewing the first-run-sequence
brainstorm (that feature wants a "Challenge a friend" CTA on its payoff screen, which
surfaced these gaps in the _existing_ challenge system):

1. **Challenge creation is gated behind finishing a run/streak.** Practice only offers
   "Share challenge" once `streakAttempts.length > 0` (correct answers only, cleared on
   any miss — `usePracticeSession.ts`). Daily/Rush/Boss only offer it at run-end. There is
   no way to challenge a friend on a single puzzle you just got _wrong_, or on any one
   puzzle without first building a streak.
2. **The challenge link carries no identity.** `/challenge` drops a recipient straight
   into puzzle 1 with zero framing (`ChallengePage.tsx`) — no sense of who sent it or
   what they're about to do. The app has no name/account system at all (fully anonymous,
   `anonId` only).

Thomas's ask, verbatim: put the challenge affordance "more in the user's face," make it
"a feature a user can solve" (i.e. the puzzle itself is the challenge, not a passive
share), thread a display name through it ("Joe challenged you"), and support challenging
on any single puzzle, not just runs. Confirmed scope: **app-wide** (Practice, Daily,
Rush, Boss, and the not-yet-built first-run sequence), name **set once, reused, editable
in Settings later**.

## Decisions locked in this pass

- **Payload version bump, breaking old links.** `CHALLENGE_PAYLOAD_VERSION` 1 → 2 to add
  `challengerName`. Any `/challenge#...` link already shared before this ships stops
  decoding (the codec's existing "unknown version → null → broken-link state" contract
  handles this with no new code) — accepted; real usage is effectively zero pre-launch,
  and forgeability/no-migration-for-old-payloads is already this domain's stated stance
  (`schema.ts`'s own doc comment).
- **Blank/skipped name never blocks sharing.** Falls back to today's generic "A friend
  challenged you!" copy.
- **One challenge button, not two competing ones.** Where a live streak exists
  (`streakAttempts.length > 0`), the button challenges the streak (richer — more
  puzzles); otherwise it challenges just the single just-answered puzzle, correct or
  not. Same button, same label, whichever input is available — no second UI element to
  design around.
- **Name storage: one new `UserProfile` field**, `challengerName: string | null` —
  mirrors `anonId`'s on-device-only, never-sent-to-telemetry posture. This is this PR's
  entire schema footprint.

## Data model changes

### `src/challenge/schema.ts`

```ts
export const CHALLENGE_PAYLOAD_VERSION = 2 // was 1

export const ChallengePayloadSchema = z
  .object({
    v: z.literal(CHALLENGE_PAYLOAD_VERSION),
    ids: z.array(z.string().min(1)).min(1).max(MAX_CHALLENGE_PUZZLES),
    results: z.array(ChallengeResultSchema).min(1).max(MAX_CHALLENGE_PUZZLES),
    totalMs: z.number().int().nonnegative(),
    // New. `null` renders as the generic "A friend" fallback — see buildChallengeIntroText.
    challengerName: z.string().min(1).max(40).nullable(),
  })
  .refine(/* unchanged */)
```

`buildChallengePayload(attempts, challengerName)` gains a second required parameter
(every call site already has `profile.challengerName` in hand). No decode-side
back-compat shim for v1 — out of scope per the decision above.

### `src/storage/schema.ts` / `migrations.ts`

- `UserProfileSchema` / `UserProfile`: `+ challengerName: z.string().min(1).max(40).nullable()`.
- `CURRENT_SCHEMA_VERSION`: 10 → 11.
- `migrateV10ToV11`: `{ ...raw, schema_version: 11, challengerName: null }` — every
  existing profile starts unnamed, prompted the first time they create a challenge (same
  as a genuinely new profile).
- `createDefaultProfile()`: `challengerName: null`.

### `src/telemetry/events.ts`

- `ChallengeCreatePayload.surface` widens by one literal: `'daily' | 'rush' | 'practice' |
'challenge' | 'first_run'` — additive, same pattern `RushAttemptContext` used to extend
  `attempt`'s context. (`'first_run'` is consumed by the first-run PR, not this one, but
  the type only has one owner so it's added here.)
- No other event changes in this PR.

## New shared pieces (replacing per-surface duplication)

Today, "build a challenge `ShareAction`" is hand-rolled independently in
`PracticePage.tsx`, `DailyPage.tsx` (via `shareText.ts`), `RushPage.tsx` (via its own
`shareText.ts`), and `ChallengeComparison.tsx`. Boss has **no** challenge action today
(grep-confirmed) — it gets one for the first time in this PR, same mechanism as the
others.

- **`src/app/useChallengerName.ts`** — thin hook: `{ name: string | null, setName:
(name: string) => Promise<void> }`. Takes `profile`/`onProfileChange` (every session
  hook already exposes an equivalent local-state setter + `saveProfile`), so it has no
  storage access of its own — it composes onto what each page already owns, the same way
  `useFeedbackNudge` stays presentation-only. `setName` persists via the caller's own
  `saveProfile` call (passed in), never a second storage write path.
- **`src/app/ChallengeButton.tsx`** — the new first-class, always-visible "⚔ Challenge a
  friend" button (accent-filled, per the mockup). Props: `attempts: ChallengeAttemptInput[]`,
  `surface: ChallengeCreatePayload['surface']`, `introLabel` (e.g. "beat my streak of 4"
  vs. "beat this one"), `challengerName`, `onNameNeeded: (name: string) => Promise<void>`.
  Internally: if `challengerName` is null, opens the name-prompt sheet first (new
  `ChallengerNameSheet.tsx`, styled like `ShareMenu`'s existing bottom sheet — same scrim/
  grabber/rounded-top treatment, not a new visual language); once a name is available
  (existing or just-saved), builds the payload and calls the same `activate()`
  share-or-copy logic `ShareMenu.tsx` already has (extracted to a small shared
  `shareOrCopy(text): Promise<'shared'|'copied'|'cancelled'>` util both components import,
  rather than forking the native-share/clipboard-fallback logic a second time).
  Fires `trackChallengeCreate` on activation, same as today.
- `ShareMenu`'s existing "Share puzzle"/"Share challenge" plain-share actions are
  **unaffected** — `ChallengeButton` is additive, sitting beside (not replacing) the
  existing share icon/menu on every surface, since plain non-challenge sharing (Daily's
  Wordle-style result text, Practice's puzzle-link share) is a separate, still-valid
  affordance.

## Per-surface wiring

- **PracticePage.tsx**: replace the `session.streakAttempts.length > 0` conditional
  `ShareAction` entry with a `ChallengeButton` rendered unconditionally once `answer`
  exists, fed `session.streakAttempts.length > 0 ? session.streakAttempts : [answer]`.
- **DailyPage.tsx**: `ChallengeButton` once `session.challengeAttempt` is set (today's
  existing gate — Daily's first attempt of the day), fed `[session.challengeAttempt]`.
- **RushPage.tsx**: `ChallengeButton` at run-end, fed the run's accumulated attempts
  (mirrors today's `buildRushChallengeText` input).
- **BossPage.tsx**: same treatment, net-new for Boss — fed the run's attempts at run-end.
- **ChallengeComparison.tsx**: counter-challenge button becomes a `ChallengeButton` fed
  `yours`, `surface: 'challenge'` — same as today's counter-challenge, just the new
  component instead of a hand-rolled `ShareAction`.

## `/challenge` landing hero + accept gate

`useChallengeSession.ts` gains a status ahead of `'playing'`: `'intro'` — reached the
instant `resolution.status === 'resolved'`, holding there (puzzle NOT yet considered
"served" — `servedAtRef` stays unset) until a new `handleAccept()` is called, which is
what actually stamps `servedAtRef.current = Date.now()` and flips to `'playing'`. This
matters for correctness, not just visuals: today's `time_ms` for puzzle 1 starts the
instant puzzle bodies resolve, which now would unfairly include however long someone
spends reading the hero — `handleAccept` is the real "the clock starts now" moment.

`ChallengePageForHash` renders the new hero (per the mockup: named greeting, puzzle
count/pattern chips, "Accept Challenge →") for `status === 'intro'`, calling
`session.handleAccept` on tap. `payload.challengerName` (nullable) drives "Joe challenged
you!" vs. "A friend challenged you!".

`ChallengeComparison.tsx`'s copy (`verdictCopy`, the stats line) also takes
`challengerName` and substitutes it for "Your friend"/"they" wherever the challenger is
referenced.

## Testing

- `codec.test.ts`: v2 payload round-trip with/without `challengerName`; a v1-shaped
  payload now decodes to `null` (broken-link) — assert that explicitly, since it's a
  deliberate behavior change from before this PR.
- `useChallengeSession.test.ts`: new `'intro'` status, `handleAccept` gates `servedAtRef`
  timing (assert `time_ms` on the first result excludes the pre-accept window).
  `ChallengeComparison.test.ts` (if it exists) / new test: challenger-name copy
  substitution.
- New `ChallengeButton.test.tsx`: renders unconditionally once attempts exist (not
  streak-gated), opens the name sheet exactly once (first-ever use), reuses a saved name
  on subsequent renders, fires `trackChallengeCreate` with the right `surface`.
- `useChallengerName.test.ts`: persists via the passed-in save callback, no direct
  storage access of its own.
- Migration test for v10 → v11 (`challengerName: null`).
- Update existing `PracticePage.test.tsx`/`DailyPage.test.tsx`/`RushPage.test.tsx`
  assertions that reference the old streak-gated challenge conditional.

## Non-goals (this PR)

- No accounts, no server-verified identity — `challengerName` is exactly as forgeable as
  the rest of the payload (documented, accepted stance already).
- No back-compat decoding of v1 challenge links.
- Boss's own run-summary UI otherwise untouched beyond adding the button.
- No changes to the rating engine, Practice's normal puzzle-selection, or Daily's
  calendar.
