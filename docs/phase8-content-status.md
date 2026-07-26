# Phase 8 content status — 2026-07-26

Analysis run against `src/content/puzzles/` at `2bbccde` (branch `content/gap-driven-generation`).

## Headline

**104 puzzles. Phase 8 DoD needs ≥150.** Running the new gap-driven generator
produces **4 puzzles**, not 46 — the refactor from count-driven to gap-driven
optimizes for _curve shape_ and silently dropped the _volume_ requirement.

Both are needed. They are different runs.

## Where the pool actually stands

| Check                            | Status                       |
| -------------------------------- | ---------------------------- |
| ≥150 puzzles                     | **FAIL** — 104               |
| Every pattern ≥8 puzzles         | PASS — all 13 at exactly 8   |
| Every pattern spans ≥800pt       | **FAIL** — 2 of 13           |
| No empty 200pt bucket (800–2199) | **FAIL** — `1200-1399` empty |

### Per-pattern spread

| Pattern               | n   | min  | max  | range   |                       |
| --------------------- | --- | ---- | ---- | ------- | --------------------- |
| off-by-one            | 8   | 1000 | 2000 | 1000    |                       |
| null-undefined        | 8   | 1000 | 2050 | 1050    |                       |
| type-coercion         | 8   | 900  | 1700 | 800     | (exactly at the line) |
| mutable-state         | 8   | 1000 | 1975 | 975     |                       |
| scope-closures        | 8   | 1000 | 1900 | 900     |                       |
| **concurrency**       | 8   | 1600 | 2100 | **500** | **FAIL**              |
| resource-management   | 8   | 900  | 2075 | 1175    |                       |
| **error-handling**    | 8   | 1000 | 1650 | **650** | **FAIL**              |
| recursion-termination | 8   | 900  | 2075 | 1175    |                       |
| data-structure-misuse | 8   | 1000 | 2050 | 1050    |                       |
| string-formatting     | 8   | 900  | 1975 | 1075    |                       |
| input-validation      | 8   | 1000 | 2075 | 1075    |                       |
| control-flow          | 8   | 1000 | 1900 | 900     |                       |

### Difficulty histogram

```
800-999      ######                          6
1000-1199    ##############################  30
1200-1399                                    0   <-- dead zone
1400-1599    ##############                  14
1600-1799    #############################   29
1800-1999    ###########                     11
2000-2199    ##############                  14
2200-2399                                    0
```

## The calibration problem (likely a real cause of "it isn't fun")

New users start at **1200**. Selection uses a **±200 window**.

A user at 1200 draws from `1000–1400` — a range where **every single puzzle sits
at 1199 or below**, in the fat 30-puzzle easy cluster. The curve is bimodal with
nothing in the middle, so as rating climbs the window drags across a void and
then hits a wall of 1600s. Progression reads as: _trivial, trivial, trivial,
sudden cliff_.

That's not a mechanic problem. A competent CS student opening this gets served
`return arr[arr.length]` as their first puzzle and concludes the app is for
beginners.

Secondary smell: ratings cluster on round numbers (many at exactly 1000, 1100,
1600, 1700, 1900, 2000). Some have been re-calibrated to off-round values
(1050, 1575, 1675, 2075); most haven't. The LLM is anchoring on round numbers
rather than applying the rubric.

## Other coverage gaps

**Language mix is lopsided:**

| Language   | n   | %   |
| ---------- | --- | --- |
| javascript | 63  | 61% |
| java       | 24  | 23% |
| python     | 15  | 14% |
| c          | 2   | 2%  |

A Python-first user hits mostly JS. Worth a target mix, the way interaction type has one.

**Interaction mix** — 36% swipe / 39% mcq / 25% tap-line. Plan targets 45/35/20.
Swipe is under-weighted, and swipe is what powers Rush.

## Recommended sequence

1. Open the PR for `content/gap-driven-generation` (already pushed to origin;
   `main` is protected, so don't fast-forward it directly).
2. `pnpm generate:puzzles --dry-run` — confirms the 4-puzzle manifest below.
   Run it live (~$0.19). Closes concurrency, error-handling, and the 1200–1399 hole.
   - concurrency @ 1200-1399 ×2 (bias low)
   - error-handling @ 1800-1999 ×2 (bias high)
3. **Add a volume mode back to the generator.** Gap-driven alone can never reach
   150 — by construction it stops once the curve is covered. Options: a
   `--target-count=N` flag that tops patterns up after gaps close, or reinstate
   the old count-driven manifest as a second pass.
4. Bias that volume run toward **1200–1500** and toward **swipe-binary**, to fill
   the dead zone new users land in and to feed Rush.
5. Re-run `pnpm content:stats` and confirm all four DoD rows pass.

## Note on the retention question

104 puzzles is roughly four sessions of content before repeats start. Fixing the
count and the curve is necessary before any conclusion about whether the core
loop retains — right now a tester runs out of material and hits a difficulty
cliff, and either failure mode would read to them as "this isn't fun."
