# Generating puzzles

How to run `src/content/tools/generatePuzzles.ts` — the LLM-assisted authoring
pipeline behind the seed content. It's gap-driven: it reads the current
per-pattern difficulty spread and global bucket coverage and generates only
what's needed to close DoD gaps, so you'll keep coming back to it as the
content set grows. Read this before your first real run and again whenever
something looks off in the output.

## Setup

1. Get an API key at [platform.claude.com](https://platform.claude.com) (Anthropic Console).
2. Copy `.env.example` to `.env` if you haven't already, and set:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
   `.env` is gitignored — the key never gets committed. Do **not** rename this
   to `VITE_ANTHROPIC_API_KEY` or anything `VITE_`-prefixed: that prefix is
   what makes Vite expose a variable to the client bundle, and this key must
   never reach the browser.

## Running it

```sh
# No API calls, no cost — prints the gap-driven manifest and a projected cost
pnpm generate:puzzles --dry-run

# Same manifest, for real: generates and writes whatever the dry-run showed
pnpm generate:puzzles
```

The manifest isn't hand-authored — `buildGapManifest()` in the script reads
real per-pattern difficulty spread and global 200pt-bucket coverage off disk
(`pnpm content:stats`'s own numbers) and generates only what's needed to
close gaps: a pattern under the 800-point spread DoD gets puzzles at
whichever end (low/high) it's missing, and any empty global bucket gets
filled by whichever fix already covers it or, failing that, by the pattern
with the most spread headroom. Idempotent — once every pattern spans >= 800
points and no bucket in range is empty, both `--dry-run` and a real run
report "nothing to generate."

**`--dry-run` always runs first, automatically** — it prints the exact same
manifest and a conservative cost projection (via `costOf`) without touching
the API. `COST_CEILING_USD` (in the script) is also enforced in the real run:
the batch checks cumulative spend before every puzzle and stops rather than
crossing it.

## What happens per puzzle

1. **Generate** — one API call (Claude Sonnet 5) given the pattern, target
   difficulty range (and which edge of it to bias toward), interaction type,
   and the full `CALIBRATION.md` rubric, using structured output so the
   model returns `PuzzleSchema`-shaped JSON directly.
2. **Validate** — the result runs through the real `PuzzleSchema` (the same
   one `pnpm validate:content` uses), including the cross-field checks
   (`correct_choice`/`correct_line` in range) that structured output alone
   can't express. On failure, the specific Zod error is fed back to the model
   for a fix, up to 3 attempts total.
3. **Self-review** — a second, separately-framed API call checks what schema
   validation can't: is the claimed bug actually in the snippet, is the
   explanation technically correct, are the wrong `mcq` choices genuinely
   wrong, does the difficulty rating roughly match what the S/T/D/C rubric
   would produce. A fail here **discards the puzzle** rather than trying to
   patch it — a puzzle whose own correctness is in doubt gets regenerated
   from scratch next run, not salvaged.
4. **Write** — on pass, writes to `src/content/puzzles/<pattern>/<id>.json`.
   IDs use a short per-pattern prefix (`oob-001`, `mut-002`, ...) tracked by
   scanning existing puzzle files, so reruns never collide with what's
   already on disk.

## When a puzzle gets discarded

The script logs it and moves on — it does not stop the batch, and it does
not retry forever. Two ways it shows up:

- `DISCARDED <id>: exceeded 3 generation attempts. Last error: ...` — the
  model couldn't produce something that passes `PuzzleSchema` after 3 tries.
  Usually a sign the prompt/rubric combination is confusing the model for
  that specific pattern+interaction+difficulty combination — worth a look if
  it happens repeatedly for the same pattern.
- `DISCARDED <id>: self-review failed — <reason>` — the puzzle validated
  structurally but the review pass found a real problem (wrong explanation,
  a not-actually-wrong `mcq` choice, a difficulty rating that doesn't match
  the rubric, etc.). Read the reason — it's specific, not generic.

Discarded puzzles don't consume an id (the counter only advances on a
successful write), so a later run will fill the gap.

## Cost

Every API call logs its own token usage and a running total, e.g.:

```
    [generate oob-004 attempt 1] in=3812 out=612 — running total: $0.0138
```

At the end of a run you get the grand total. Two calls per puzzle (generate +
review, occasionally a couple of extra generate-retry calls) — a gap-driven
batch is usually a handful of puzzles, not dozens, so real spend is normally
a few cents to low tens of cents; verify from the printed total rather than
trusting any number here as it ages. Pricing and the model's average output
length can both drift. Current pricing is in the script's
`INPUT_COST_PER_MTOK`/`OUTPUT_COST_PER_MTOK` constants, with a link to
confirm it's still current. `COST_CEILING_USD` is a hard stop independent of
all this — the batch checks cumulative spend before every puzzle and halts
rather than crossing it, regardless of how the estimate above ages.

## After a run: read the output, don't just check the exit code

```sh
pnpm validate:content   # confirms everything written passes schema + unique ids
pnpm content:stats      # per-pattern / per-interaction / difficulty-histogram counts
```

`content:stats` is the tool for spotting coverage gaps — a pattern stuck at
2 puzzles when you meant to target 8, an interaction type that's
underrepresented, a difficulty histogram bunched in one band. Actually read
it; a clean `validate:content` exit code only tells you the content is
_valid_, not that it's _good_ or _complete_.

While you're looking at the batch, nominate its hardest puzzles as
candidates for `src/content/dailyCalendar.ts` — the curated, append-only
calendar Daily mode serves from (see that file's header comment for the
append-only contract before touching it).

## The self-review pass doesn't replace you

Self-review catches structural and logical problems an LLM can check for
itself — the bug isn't where it's claimed, an explanation is wrong, a
distractor is secretly also correct. It does **not** replace the human
spot-check that Phase 8 already requires: 15 random puzzles, blind
re-estimate their difficulty against `CALIBRATION.md`'s rubric yourself,
confirm ≥12 land within ±200 of the assigned rating. This script gets you
content fast. It does not get you content you never have to look at — treat
every batch as a draft until you've eyeballed a sample of it.
