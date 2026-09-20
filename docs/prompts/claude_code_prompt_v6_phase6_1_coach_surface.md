# Claude Code prompt: v6 Phase 6.1 — misconception vocabulary + the coach surface

## Read first

1. `docs/superpowers/plans/2026-09-19-wrong-answer-explanations-spec.md` — especially **§3.2a, the
   2026-09-20 amendment**, which is what Piece 0 below implements, plus §5.2 (fetch timing), §5.3
   (rendering) and §6 (free/paid split).
2. `docs/v6-build-plan.md` Phase 6.1.
3. The 6.0 amendment on `feat/v6-phase6-0-wrong-answer-explanations` (commit f1a0b92).

**Decisions already settled — do not reopen, do not ask:**

- Metered free taste = **3 coach explanations per week**, resetting on a fixed UTC weekly boundary.
- Coach applies to **Practice and Daily. Not Rush** — Rush is timed and a coach panel fights the clock.
  Boss and Missions follow Practice's behavior where they reuse its surfaces.
- Entitlement does not exist yet (that is 6.2). This phase gates on a **single injectable predicate**
  with a hardcoded `false` default, so 6.2 swaps in the real check without touching any UI code.

## Piece 0 — misconception vocabulary consolidation (blocking, do this first)

The 6.0 batch shipped 274 distinct non-filler misconception labels across 292 entries — 96%
singletons, 11 labels ever reused. Spec §3.2a has the measurement and the reasoning. The field
exists solely to be 6.3's aggregation taxonomy, and in its current state it cannot serve that.

**This is a relabel, not a regeneration. Do not touch a single character of `why_wrong` prose** —
it was read and passed on 2026-09-20 and it is the expensive part.

1. Extract the full distinct label list from `src/content/explanations/*.json`.
2. Cluster it into a canonical vocabulary of roughly **25–40** labels, working over the label list
   and a sample of each label's `why_wrong` text — not over the whole puzzle pool. Keep
   `not-the-bug-site` verbatim; it is 452 of 745 entries and a real signal.
3. Create `src/content/misconceptions.ts` modelled directly on `patterns.ts` — a
   `MISCONCEPTION_SLUGS` literal array, a `MisconceptionSlug` type, and human-readable labels for
   the 6.3 UI.
4. Change `ExplanationEntrySchema.misconception` from the free regex to
   `z.enum(MISCONCEPTION_SLUGS)`. Mechanical enforcement from here on.
5. Rewrite every entry's `misconception` to its canonical label, in place.
6. Update `generateExplanations.ts` so its prompt receives the vocabulary as a **closed list** and
   must pick from it, with a single documented escape hatch if nothing fits.
7. Write `docs/v6-misconception-vocabulary-2026-09-20.md`: the final vocabulary, each label's entry
   count after consolidation, and the raw→canonical mapping, so the collapse is auditable.

**DoD for Piece 0:** no label outside the enum survives anywhere; `pnpm validate:explanations`
green; every `why_wrong` string byte-identical to f1a0b92 (prove it with a diff that shows only
`misconception` lines changed); no canonical label covers more than ~25% of non-filler entries
(if one does, the clustering collapsed too far — re-split it).

## Piece 1 — the coach panel

Render the wrong-answer explanation in the existing feedback drawer in `PuzzleCardShell.tsx`,
**below** the free `explanation`, never replacing it. §5.3: the drawer already caps its panel and
scrolls only the explanation region, for a reason documented at length in that file — the coach
block goes _inside_ that same scrolling region. Do not add a second scroll container and do not let
the coach text push the Continue button anywhere.

Load through `getExplanationSet` from `src/content/explanations` — a **deep import, never the
barrel** (F32; `barrelBoundary.test.ts` already fails on the barrel path). Mirror
`puzzleBodyCache.ts`'s shared-promise cache exactly; do not invent a second caching pattern.

## Piece 2 — fetch timing and the meter

Fetch only when **all** of: the answer was wrong, the mode is Practice or Daily, and the viewer is
entitled or has meter remaining. Never on puzzle load, never speculatively. An unentitled viewer
past their meter must cause **zero** explanation chunk requests — that is both the bundle-discipline
requirement and the closest thing this layer has to access control.

The meter counter lives in the versioned export format (the v5 sync payload), like every other
preference, so it syncs across devices. A new field there must go into the versioned format, not
loose localStorage — that rule predates this phase.

## Piece 3 — the free-tier treatment

When the meter is spent, show the misconception label (now a real human-readable one from Piece 0)
and one honest line. **No blurred paragraph, no fake preview, no "4 more insights available"
counter.** The label alone is genuinely useful and giving it away costs nothing. Spec §6.

## DoD

- [ ] Piece 0's four DoD lines, including the byte-identical `why_wrong` proof
- [ ] Coach panel renders below the free explanation, inside the existing scroll region
- [ ] Continue button stays visible with the longest explanation in the library — verify against the
      actual longest, don't assume
- [ ] A free viewer's first 3 wrong answers of the week show the coach; the 4th shows the label only
- [ ] Zero explanation network requests for a spent-meter viewer, verified in devtools
- [ ] Rush shows no coach panel at all
- [ ] Play-path bundle size unchanged against the perf baseline — measured against a real build
- [ ] The entitlement predicate is one injectable function, defaulting false, with no UI code
      depending on how it is implemented
- [ ] `pnpm validate` green
- [ ] Amendment written, listing what 6.2 must swap in

## Out of scope

Stripe, the entitlements table, `GET /api/entitlement`, the 6.3 diagnostic, scrubber/drag-order
explanations, swipe-binary generation.
