# Wrong-answer explanations — design spec (v6 Phase 6.0 / 6.1)

**Written 2026-09-19.** Companion to `docs/v6-build-plan.md`. This document carries the task
specs; sessions should be pointed here rather than at a hand-written prompt that duplicates it
(the lesson recorded at the close of Phase 5.2).

## 1. The idea in one paragraph

Every puzzle already ships an `explanation` field describing why the bug is a bug. That is
generic — it is the same text no matter what the player did. The coach layer adds a second,
targeted explanation keyed to **the specific wrong answer the player chose**: why that particular
choice is wrong, what misconception it corresponds to, and what the real distinction is. That is
what a tutor sitting next to them would say, and it is the thing free alternatives do not do.

## 2. Why this is cheap here and expensive for everyone else

**Every interaction type in this codebase has a bounded wrong-answer space.** There is no
free-text answer anywhere in `src/content/schema.ts`.

| Interaction  | Puzzles | Wrong-answer space                           | Wrong answers total |
| ------------ | ------- | -------------------------------------------- | ------------------- |
| mcq          | 60      | `choices.length - 1` (≤4)                    | **185**             |
| tap-line     | 39      | every line except `correct_line`             | **~560**            |
| swipe-binary | 61      | exactly 1                                    | 61                  |
| scrubber     | 59      | ≤4 per checkpoint, 2–8 checkpoints           | deferred            |
| drag-order   | 35      | factorial — the one genuinely unbounded case | deferred            |

(Counts measured off `src/content/puzzles/` on 2026-09-19: 254 puzzle files.)

So the entire explanation set can be **generated once, offline, and shipped as static content**.
Consequences, all of which are the actual product advantage:

- Zero runtime cost. No per-request token bill, ever.
- Zero latency at the worst possible moment — immediately after a wrong answer.
- Works offline, which keeps the local-first guarantee intact.
- No prompt-injection or LLM abuse surface in production, because there is no LLM in production.
- No new server dependency on the play path.

First batch is **mcq + tap-line** (745 explanations). swipe-binary is trivially cheap and can
ride along if the pipeline is working. scrubber and drag-order are deferred — see §10.

## 3. Content model

### 3.1 Where the files live

```
src/content/explanations/<puzzle-id>.json
```

One file per puzzle, flat, named by puzzle id. **Not** a field added to the puzzle JSON, and
**not** re-exported from `src/content/index.ts`. Both of those are load-bearing decisions, not
style preferences — see F32 and F37.

### 3.2 Schema

New file `src/content/explanationSchema.ts`, following the same Zod conventions as `schema.ts`:

```ts
const ExplanationEntrySchema = z.object({
  // For mcq: the CANONICAL index into puzzle.choices (see F35).
  // For tap-line: the zero-based line index into the snippet.
  // For swipe-binary: 0 = the wrong direction. Always exactly one entry.
  target: z.number().int().nonnegative(),

  // 2-3 sentences, addressed to someone who just picked this. Second person.
  // Explains why THIS choice is wrong, not what the right answer is.
  why_wrong: z.string().min(40).max(600),

  // A short kebab-case label for the underlying misconception. Reused across
  // puzzles wherever the same confusion appears. This is the taxonomy the 6.3
  // diagnostic is built on -- it is generated here so it never needs a retrofit.
  misconception: z.string().regex(/^[a-z0-9-]{3,48}$/),
})

const ExplanationSetSchema = z.object({
  puzzle_id: IdSchema,
  interaction: z.enum(['mcq', 'tap-line', 'swipe-binary']),
  generated_at: z.string(), // ISO date, for staleness auditing
  generator_version: z.number().int(), // bump when the prompt changes materially
  entries: z.array(ExplanationEntrySchema).min(1),
})
```

`misconception` is the sleeper feature. It gives Phase 6.3's diagnostic a grain finer than the 13
pattern slugs — "you consistently read `len(x)` as the last valid index" is a far more useful
thing to tell a player than "you are 62% on off-by-one." Generating it now costs nothing extra
and avoids a second pass over the whole library later.

### 3.3 What the copy should and should not do

- **Address the choice they made.** "You picked the version that checks `i <= len`" — not a
  restatement of the correct answer.
- **Name the confusion, then draw the distinction.** Two moves, in that order.
- **Never reference ordinal position.** No "the second option", "choice B", "the one above".
  mcq choices are shuffled per serving (F35) so any positional reference is wrong roughly
  three-quarters of the time.
- **No praise, no scolding.** "Close — this is the classic..." is fine. "Great attempt!" is not.
- Same inline-markdown subset the existing `explanation` field uses, so
  `src/app/practice/inlineMarkdown.tsx` renders it without changes. Backtick code spans, nothing else.

## 4. Generation pipeline

New tool: `src/content/tools/generateExplanations.ts`, following the conventions established by
`generatePuzzles.ts` and `generateScrubberPuzzles.ts`.

### 4.1 Backend

Reuse `src/content/tools/llmBackend.ts` as-is. Do not write a new LLM call path.

**Critical, and already documented in that file's own header:** the `cli` backend shells out to
`claude -p`, which draws on the invoking account's subscription rather than Console credits — but
`claude -p` prefers `ANTHROPIC_API_KEY` whenever one is in the environment, and the repo's
`generate:*` scripts run under `tsx --env-file=.env`, which puts it there on every real
invocation. `buildCliChildEnv` strips the Anthropic auth vars before spawning the child, and that
is the only reason the CLI backend bills the right account. **Route through it. Do not
reimplement the spawn.** (F33)

### 4.2 Per-call input

One LLM call per puzzle, not per wrong answer — the model needs to see all the distractors
together to avoid writing three explanations that say the same thing. Input:

- the full puzzle object (snippet, prompt, language, pattern, difficulty)
- the existing `explanation` field — this is the ground truth for what the bug actually is, and
  anchoring on it is what keeps the generated text from inventing a different bug
- the correct answer, explicitly
- the list of wrong targets to explain
- for tap-line, the snippet split into numbered lines

Output is parsed by `ExplanationSetSchema.safeParse`. Per `generatePuzzles.ts`'s own doc comment,
**that Zod pass is the one authoritative check** — the backend's job stops at "did it produce
something JSON-shaped."

### 4.3 Run discipline

- `pnpm generate:explanations [--pattern <slug>] [--interaction <type>] [--force]`
- **Idempotent by default**: a puzzle with an existing file that validates is skipped unless
  `--force`. A crashed or rate-limited run is resumed by re-running the same command.
- **Write per-puzzle, immediately.** Never accumulate a batch in memory and write at the end;
  a 60-puzzle run that dies at puzzle 58 must not lose 57 files.
- Batch by pattern so a run is a bounded unit of work and a bad prompt is caught after 15
  puzzles rather than 254.
- Print a summary: generated, skipped, failed, with failures listed by id.

### 4.4 tap-line's long tail

~560 wrong lines across 39 puzzles is ~14 per puzzle, and many are structurally uninteresting —
a blank line, a closing brace, a function signature. Generating three earnest sentences about why
a blank line is not the bug is wasted effort and reads as padding.

**Decision: generate for every line anyway, but allow a short form.** The player can tap any line
and deserves a response for whatever they tapped. The prompt instructs: for a line that is not a
plausible location for this bug, one sentence saying what the line does and why the bug cannot be
there. `why_wrong`'s 40-character floor still applies. The `misconception` for these is
`not-the-bug-site` — a real signal, since a player who repeatedly taps unrelated lines is not
reading the snippet.

## 5. Runtime loading

### 5.1 The barrel-boundary rule (F32 / F37)

`src/content/pools.ts` exists as a separate module from the content barrel for a measured reason,
documented at length in its own header: ES modules evaluate per file, so re-exporting an eager
`import.meta.glob` from `index.ts` dragged all 214 puzzle bodies into every chunk that imported
anything at all from the barrel (79.74 KB static vs. 53.84 KB without). This repo has already paid
for that lesson once.

Explanations must not repeat it:

- The explanation glob lives in `src/content/explanations.ts`, a module of its own.
- It is **never** re-exported from `src/content/index.ts`.
- `src/content/barrelBoundary.test.ts` is extended to fail if any file imports the explanation
  loader from a `.../content` barrel path, exactly as it already does for
  `puzzlePool`/`quizPool`/`scrubberPool`.
- The loader is a dynamic-import glob (`{ eager: false }`), so each puzzle's explanations are
  their own chunk.

### 5.2 Fetch timing

Mirror `src/app/practice/puzzleBodyCache.ts` exactly — a shared `Map<string, Promise<...>>`, one
in-flight promise per id, rejected promises evicted so a retry can re-attempt. Do not invent a
second caching pattern.

Fetch is triggered **only** when all of these hold: the answer was wrong, and the viewer is
entitled (or has meter remaining). Not on puzzle load, not speculatively. An unentitled player
must never cause an explanation chunk to be fetched beyond their meter — that is both the
bundle-discipline requirement and the closest thing to access control this layer has.

### 5.3 Rendering

The feedback drawer in `PuzzleCardShell.tsx` already caps its panel and scrolls only the
explanation paragraph (there is a long comment there explaining why — an uncapped panel with a
long explanation pushed the Continue button off-screen). The coach block goes **inside** that
same scrolling region, below the free explanation. Do not add a second scroll container and do not
let the coach text push the Continue button anywhere.

## 6. Free versus paid

**The law: the paid tier adds, it never removes.** The existing `explanation` field stays free and
unchanged for everyone, signed in or not.

|                                               | Free    | Coach                               |
| --------------------------------------------- | ------- | ----------------------------------- |
| Why the bug is a bug (existing `explanation`) | yes     | yes                                 |
| Why _your_ answer was wrong (`why_wrong`)     | metered | yes                                 |
| Misconception label                           | shown   | shown, and linked to the diagnostic |
| Drill this misconception                      | no      | yes (6.3)                           |
| Misconception breakdown in Stats              | no      | yes (6.3)                           |

**Metered taste, not a time trial.** Recommendation: 3 coach explanations per week for free and
signed-out users, resetting on a fixed weekly boundary. A time-limited trial creates one buying
moment and then a cliff; a weekly meter re-creates the buying moment every week, in-flow, at the
moment the player has just felt the value. The counter lives in the versioned export format like
every other preference, so it syncs.

When the meter is spent, show the misconception label and an honest line — never a blurred
paragraph, a fake preview, or a count of "4 more insights available." The label alone is a real,
useful thing and giving it away costs nothing.

## 7. Entitlement (Phase 6.2)

Migration `0003_entitlements.sql`:

```sql
CREATE TABLE entitlements (
  clerk_user_id          TEXT PRIMARY KEY REFERENCES users(clerk_user_id) ON DELETE CASCADE,
  tier                   TEXT NOT NULL CHECK (tier IN ('free', 'coach')) DEFAULT 'free',
  stripe_customer_id     TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  current_period_end     INTEGER,
  updated_at             INTEGER NOT NULL
);
```

- `GET /api/entitlement` → `{ tier, currentPeriodEnd }`. A small endpoint of its own, **not**
  folded into the profile payload: `profiles.payload` is a gzipped blob that `profileStore.ts` is
  the only permitted reader/writer of, enforced by a drift-guard test. Do not contaminate it.
- `POST /api/stripe/webhook` — see F34, this is the sharp one.
- Client caches the entitlement with a **7-day grace window**: fails open inside it so a paying
  subscriber offline on a plane keeps their coach, fails closed after (F36).

**The client gate is display-only and the spec says so out loud.** A determined user can fetch the
explanation chunks directly. That is acceptable and deliberate: this content is worth money because
it is convenient and in-flow, not because it is secret, and defeating the gate costs more effort
than the subscription. If piracy ever becomes measurable — it will not at this scale — the
documented upgrade path is moving explanation delivery behind an authenticated Worker route, at the
cost of the offline guarantee. Do not build that now.

## 8. Validation and quality gates

New CLI `src/content/tools/validateExplanations.ts`, wired into `pnpm validate` and CI beside
`validateContent.ts`. It must fail on:

1. An explanation file whose `puzzle_id` matches no real puzzle.
2. A `target` out of range for its puzzle (`choices.length`, snippet line count).
3. A duplicate `target` within a set.
4. **An entry targeting the correct answer.** That is always a generation bug.
5. Missing coverage: an mcq or tap-line puzzle with no explanation file, or with fewer entries
   than it has wrong answers. **This is the rule that stops coverage rotting** as new puzzles are
   authored — a new puzzle without explanations fails CI.
6. Any ordinal reference in `why_wrong` — a regex over "option A/B/C", "first/second/third
   option", "the one above/below". Crude, and it will produce the occasional false positive worth
   eating (F35).
7. Schema/length bounds.

### The gate that actually matters

**A stratified human read of at least 20 generated explanations before the batch ships** —
sampled across patterns, difficulty bands and both interaction types. An LLM-generated explanation
that is confidently and subtly wrong is _worse than none_, because a paying user has been told to
trust it. Zod cannot catch a plausible-sounding false claim about Python's slice semantics.

**The generating session must not be the grading session.** A model checking its own output for
confident-but-wrong claims about language semantics is the weakest possible reviewer for exactly
the failure mode that matters. 6.0 _stages_ the sample — a readable file with 20 stratified
entries and a blank verdict column — and the read is performed by Thomas or a fresh-context
session.

Record: how many were read, how many were wrong, what kind of wrong, and what was regenerated. If
more than 2 of 20 are substantively wrong, the prompt is broken — fix it and regenerate the batch
rather than patching individual files.

## 9. Footgun register

Continuing the numbering in `docs/superpowers/plans/2026-08-27-v5-accounts-implementation-plan.md`
(last used: F31).

- **F32 — barrel boundary.** The explanation glob must live in its own module and must never be
  re-exported from `src/content/index.ts`. Re-exporting it makes Rollup treat it as side-effectful
  and puts the whole explanation library in every chunk importing anything from the barrel. This is
  the exact mistake `pools.ts` documents, measured at +25.9 KB. Extend `barrelBoundary.test.ts`.
- **F33 — the CLI backend bills the wrong account.** `claude -p` prefers `ANTHROPIC_API_KEY` over
  subscription auth, and `--env-file=.env` puts one in the environment on every real run. Go
  through `buildCliChildEnv`. Symptom if missed: a silent Console bill and no error.
- **F34 — the Stripe webhook is the second unauthenticated write endpoint** in the system, after
  `/api/report`. An authz suite structurally cannot cover it, so it needs its own T13 line, exactly
  as `/api/report` does. Required: Stripe signature verification before any body parsing,
  idempotency keyed on `event.id` (Stripe retries, and a non-idempotent handler double-applies),
  strict per-IP rate limiting, and no PII stored beyond the Stripe ids.
- **F35 — mcq choices are shuffled per serving.** `Mcq.tsx` computes `shuffledIndices(...)` in a
  `useState` initializer and maps back through `originalIndex`. Therefore: key entries by the
  canonical index into `puzzle.choices`, and ban ordinal references in the prose. Getting this
  wrong produces explanations that describe the wrong distractor roughly three-quarters of the time
  and will read as the product being broken.
- **F36 — entitlement cache direction.** Fails open for 7 days (offline subscriber keeps access),
  closed after. A cache that fails closed immediately punishes paying users on bad connections; one
  that fails open forever is not a paywall.
- **F37 — do not "simplify" by inlining later.** Adding explanations as a field on the puzzle JSON
  would change every puzzle body chunk and feed the `puzzleMetaPlugin` virtual module, putting paid
  content on the free play path. The separate-file design is the point, not an accident of
  convenience.
- **F38 — deleting an account must cancel the Stripe subscription.** `ON DELETE CASCADE` removes
  the entitlements row; it does not tell Stripe anything. Without an explicit cancel call, a user
  who deletes their account keeps getting billed for a product whose data is gone. This is a defect
  and an ethical problem, and it extends T13's deletion round-trip, which must be re-run and
  re-evidenced after 6.2.

## 10. Deferred, with reasons

- **scrubber** (59 puzzles, 2–8 checkpoints × ≤4 choices). Bounded and therefore generatable, but
  a checkpoint's wrong choice needs the execution state at that step to explain properly, which is
  a materially harder prompt. Revisit once mcq/tap-line have shipped and the prompt is proven.
- **drag-order** (35 puzzles). The only genuinely unbounded space — wrong orderings are factorial.
  A per-arrangement explanation is impossible; the tractable version is explaining _the first
  misplaced block relative to the correct order_, which is a different feature. Not in 6.0.
- **swipe-binary** (61 puzzles, one wrong answer each). Trivially cheap. Not in the first batch only
  to keep it small; fold in as soon as the pipeline is proven.

## 11. Open decisions — need Thomas, not a session

1. **Price.** Recommendation: $7/month or $49/year, annual pushed hard because monthly churn on
   self-improvement products is brutal. Not settled.
2. **Meter size.** Recommendation: 3 per week. Not settled.
3. **Does the coach layer apply to Daily/Rush/Boss, or Practice only?** Recommendation: Practice
   and Daily yes, Rush no — Rush is a timed mode and a coach panel fights the clock.
4. **Whether swipe-binary rides along in the first batch.**
