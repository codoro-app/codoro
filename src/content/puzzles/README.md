# puzzles/

One JSON file per puzzle, in `<pattern>/<id>.json` — the pattern folder is
purely organizational (the file's own `pattern` field is what's actually
validated and read; folder placement isn't checked). Per-file layout is
deliberate: clean git diffs, no merge conflicts while authoring daily.

See `../README.md` for the field list per interaction type, `../PATTERNS.md`
for the 13 pattern folders this is organized into, and `../CALIBRATION.md`
for how to set `difficulty_rating`.

The initial 29-puzzle seed batch (Phase 3's ~25-puzzle target) was generated
via `../tools/generatePuzzles.ts` — see `../GENERATING_PUZZLES.md` for how to
run that pipeline yourself and add more. `pnpm validate:content` and
`pnpm content:stats` handle an empty directory cleanly too (0 puzzles, not an
error), so the tooling stays safe to run before any content exists — that
mattered while this folder was empty and still holds for a from-scratch
checkout of the tooling alone.
