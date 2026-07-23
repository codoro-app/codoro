# Generating puzzles

How to run `src/content/tools/generatePuzzles.ts` — the LLM-assisted authoring
pipeline behind the seed content. You'll keep using this well past the initial
25-puzzle batch, so read this before your first real run and again whenever
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
# Cheap sanity check first: 3 puzzles, one per interaction type
pnpm generate:puzzles --dry-run

# Full batch: generates the manifest baked into the script (currently 25
# puzzles spanning all 13 patterns and the ~45/35/20 swipe-binary/mcq/tap-line
# mix)
pnpm generate:puzzles
```

There's no other CLI surface today — the manifest (which pattern/interaction/
difficulty-band combinations to generate) is defined in `buildFullManifest()`
and `buildDryRunManifest()` inside the script. To generate a different batch
(more of one pattern, a different mix), edit those functions rather than
bolting on flags — the script is small enough that editing the manifest
directly is simpler than building a generic CLI grammar for it.

**Always run `--dry-run` before spending real budget on a new manifest.**
Read the 2-3 puzzles it produces against `CALIBRATION.md` yourself — see
"Reading the output" below — before trusting a bigger run.

## What happens per puzzle

1. **Generate** — one API call (Claude Sonnet 5) given the pattern, target
   difficulty band, interaction type, and the full `CALIBRATION.md` rubric,
   using structured output so the model returns `PuzzleSchema`-shaped JSON
   directly.
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

At the end of a run you get the grand total. The full 25-puzzle batch (two
calls per puzzle: generate + review, occasionally a couple of extra
generate-retry calls) has run in the low single dollars — verify this
yourself from the printed total rather than trusting this number as it ages;
pricing and the model's average output length can both drift. Current
pricing is in the script's `INPUT_COST_PER_MTOK`/`OUTPUT_COST_PER_MTOK`
constants, with a link to confirm it's still current.

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
