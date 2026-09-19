# Claude Code prompt: v6 Phase 6.0 — wrong-answer explanation pipeline

## Read first

`docs/superpowers/plans/2026-09-19-wrong-answer-explanations-spec.md` — **the spec carries the
task detail; this prompt does not repeat it.** Read the whole thing, especially §5 (runtime
loading), §8 (validation) and §9 (the footgun register, F32–F38). Then `docs/v6-build-plan.md`
for why this version exists, and `docs/v5-closeout-decision.md` for the deadline driving it.

This session builds the pipeline and runs the first batch. It does **not** build the coach UI,
entitlements, or Stripe — those are 6.1 and 6.2.

## Pieces

**Piece 0 — verify two assumptions before writing anything.** The spec is written from a read of
the repo, not from running it. Confirm: (a) `Mcq.tsx` shuffles choices per serving via
`shuffledIndices` and maps back through `originalIndex`, so a canonical index is the right key
(F35); (b) `llmBackend.ts`'s `buildCliChildEnv` still strips the Anthropic auth vars, so the CLI
backend bills the subscription rather than the Console account (F33). If either is wrong, stop and
say so before generating anything — both change the design.

**Piece 1 — `src/content/explanationSchema.ts`.** The Zod schemas in §3.2, following `schema.ts`'s
conventions. Unit-tested at the bounds like `schema.test.ts` is.

**Piece 2 — `src/content/tools/generateExplanations.ts`.** Per §4. One LLM call per puzzle, not per
wrong answer. Idempotent, resumable, writes per-puzzle files immediately, batched by pattern.
Route through the existing `llmBackend.ts` — do not write a new spawn path.

**Piece 3 — `src/content/tools/validateExplanations.ts`** plus its `pnpm validate` and CI wiring.
All seven failure conditions in §8, including the coverage rule (a new mcq/tap-line puzzle with no
explanation file fails CI — this is what stops coverage rotting) and the ordinal-reference regex.

**Piece 4 — `src/content/explanations.ts`**, the lazy dynamic-import glob loader. §5.1 is the part
to get right: its own module, never re-exported from the content barrel, `barrelBoundary.test.ts`
extended to enforce it. This repo has already paid 25.9 KB for that exact mistake once
(`pools.ts`'s header documents it). Verify against a real production build that no explanation
content entered any pre-existing chunk — measured, not asserted.

**Piece 5 — run the first batch.** mcq (60 puzzles, 185 wrong choices) then tap-line (39 puzzles,
~560 wrong lines). Batch by pattern. Report generated/skipped/failed counts.

**Piece 6 — the human read.** §8's stratified sample of ≥20 across patterns, difficulty bands and
both interaction types. Read them as a skeptical engineer, not as a proofreader: the failure mode
is a confident, fluent, factually wrong claim about language semantics, and Zod cannot see it.
Record in the amendment how many were read, how many were wrong, what kind of wrong. **If more
than 2 of 20 are substantively wrong, the prompt is broken — fix the prompt and regenerate the
batch rather than hand-patching files.**

## DoD

- [ ] Piece 0's two assumptions confirmed in writing (or the design corrected)
- [ ] Every mcq and tap-line puzzle has a schema-valid explanation file
- [ ] No entry targets a correct answer anywhere in the batch
- [ ] No ordinal references ("option B", "the second choice") survive validation
- [ ] `validate:explanations` is in `pnpm validate` and CI, and fails on a puzzle with no file
- [ ] `barrelBoundary.test.ts` fails if the explanation loader is imported from a barrel path
- [ ] Production build measured: zero explanation bytes in any pre-existing chunk
- [ ] Zero changes to any file under `src/content/puzzles/`
- [ ] The ≥20-sample human read done and recorded with findings
- [ ] `pnpm validate` green
- [ ] Amendment written, including the open decisions from §11 that this session did not settle

## Out of scope

The coach UI, the free/paid split, the meter, entitlements, Stripe, the 6.3 diagnostic. Also
scrubber and drag-order explanations (§10) — bounded-but-harder and genuinely-unbounded
respectively. swipe-binary may ride along if the pipeline is clean and time remains; it is one
wrong answer per puzzle across 61 puzzles.
