/**
 * Curated, ordered list of puzzle IDs served one per calendar day by Daily
 * mode. Entry N (0-indexed) is served on day-index N — see
 * `getDailyCalendarIndex` in src/engine/daily.ts, which maps a date string to
 * a position in this array (wrapping once the date runs past the end).
 *
 * CONTRACT — append-only:
 *   - Only ever ADD new entries to the end.
 *   - NEVER reorder, remove, or edit the value at an existing position.
 *   Appending can't change what any earlier day-index resolves to, by
 *   construction — that's the whole point. Reordering or editing a past
 *   entry reshuffles every date at and after that position, breaking "same
 *   date -> same puzzle" for anyone who already saw those days.
 *
 *   dailyCalendar.test.ts pins the current prefix and fails the build if it's
 *   touched — see that file for how to extend the pin when you append here.
 *
 * Every ID here must resolve to a real puzzle in src/content/puzzles/
 * (enforced by `pnpm validate:content`), and IDs must be unique within this
 * array (also enforced there).
 *
 * PRE-LAUNCH NOTE: while DAILY_EPOCH (src/engine/daily.ts) is still the
 * `2026-01-01` placeholder, this file may be freely edited/reordered/swapped
 * — the append-only guarantee is meaningless until the real epoch is frozen,
 * since every date currently resolves through the wrap fallback anyway. Once
 * DAILY_EPOCH is set to the real launch date, treat every line above the
 * newest addition as immutable.
 *
 * Rebuild (2026-08-29): 39 entries, all rated >= 1600 and restricted to
 * scrubber/drag-order/tap-line — mcq and swipe-binary are excluded entirely,
 * since Daily is meant to hold the pool's hardest, most involved puzzles and
 * those two interactions cap out too shallow for that bar. Every entry also
 * clears the new length floor for its interaction: scrubber puzzles carry at
 * least 6 checkpoints, drag-order puzzles at least 8 blocks, and tap-line
 * puzzles a snippet of at least 15 lines with a genuinely subtle bug (not a
 * one-glance spot). This replaces the 2026-07-22 seed wholesale rather than
 * appending to it — see docs/superpowers/plans for the phase that produced
 * this batch — and is ordered hardest-first by difficulty_rating. Expect more
 * entries as content authoring ramps; each new content batch should nominate
 * its hardest puzzles meeting this length bar as candidates (see
 * GENERATING_PUZZLES.md).
 */
export const DAILY_CALENDAR: readonly string[] = [
  'inp-015', // 2100 tap-line input-validation
  'nul-013', // 1950 tap-line null-undefined
  'con-014', // 1900 drag-order concurrency
  'con-015', // 1900 tap-line concurrency
  'dsm-025', // 1800 scrubber data-structure-misuse
  'tc-026', // 1800 drag-order type-coercion
  'tc-027', // 1800 tap-line type-coercion
  'rec-028', // 1800 tap-line recursion-termination
  'err-018', // 1800 tap-line error-handling
  'mut-025', // 1700 scrubber mutable-state
  'tc-025', // 1700 scrubber type-coercion
  'cf-029', // 1700 scrubber control-flow
  'rec-026', // 1700 scrubber recursion-termination
  'rec-027', // 1700 drag-order recursion-termination
  'err-017', // 1700 drag-order error-handling
  'scl-026', // 1700 drag-order scope-closures
  'mut-027', // 1700 drag-order mutable-state
  'res-015', // 1700 drag-order resource-management
  'dsm-027', // 1700 drag-order data-structure-misuse
  'nul-012', // 1700 drag-order null-undefined
  'inp-014', // 1700 drag-order input-validation
  'str-014', // 1700 drag-order string-formatting
  'scl-027', // 1700 tap-line scope-closures
  'mut-028', // 1700 tap-line mutable-state
  'str-015', // 1700 tap-line string-formatting
  'dsm-028', // 1700 tap-line data-structure-misuse
  'cf-032', // 1700 tap-line control-flow
  'res-016', // 1700 tap-line resource-management
  'oob-024', // 1650 scrubber off-by-one
  'tc-024', // 1650 scrubber type-coercion
  'mut-024', // 1625 scrubber mutable-state
  'mut-026', // 1625 scrubber mutable-state
  'oob-025', // 1600 scrubber off-by-one
  'oob-026', // 1600 scrubber off-by-one
  'scl-024', // 1600 scrubber scope-closures
  'scl-025', // 1600 scrubber scope-closures
  'cf-030', // 1600 scrubber control-flow
  'rec-025', // 1600 scrubber recursion-termination
  'dsm-026', // 1600 scrubber data-structure-misuse
]
