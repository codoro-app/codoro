# puzzles/

One JSON file per puzzle, in `<pattern>/<id>.json` — the pattern folder is
purely organizational (the file's own `pattern` field is what's actually
validated and read; folder placement isn't checked). Per-file layout is
deliberate: clean git diffs, no merge conflicts while authoring daily.

See `../README.md` for the field list per interaction type, `../PATTERNS.md`
for the 13 pattern folders this is organized into, and `../CALIBRATION.md`
for how to set `difficulty_rating`.

Empty right now — no puzzles authored yet. `pnpm validate:content` and
`pnpm content:stats` both handle that cleanly (0 puzzles, not an error), so
the tooling is safe to run and wire into CI before any content exists.
