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
 * Seed (2026-07-22): 16 entries, all rated >= 1600 (the full 29-puzzle pool's
 * median difficulty), spanning mcq/swipe-binary/tap-line. The pool doesn't
 * yet have enough distinct puzzles above-median to seed the ~40 entries a
 * mature calendar wants without repeating an ID (which the no-duplicate rule
 * forbids) — this seed uses every puzzle at or above the median once. Expect
 * more entries as content authoring ramps; each new content batch should
 * nominate its hardest puzzles as candidates (see GENERATING_PUZZLES.md).
 */
export const DAILY_CALENDAR: readonly string[] = [
  'nul-001', // 1600 mcq null-undefined
  'con-002', // 1600 tap-line concurrency
  'mut-002', // 1600 swipe-binary mutable-state
  'cf-002', // 1600 tap-line control-flow
  'oob-002', // 1600 swipe-binary off-by-one
  'tc-002', // 1600 mcq type-coercion
  'mut-001', // 1600 tap-line mutable-state
  'err-001', // 1650 swipe-binary error-handling
  'scl-002', // 1650 swipe-binary scope-closures
  'res-003', // 1700 tap-line resource-management
  'dsm-001', // 1675 swipe-binary data-structure-misuse
  'rec-002', // 1700 mcq recursion-termination
  'scl-001', // 1700 mcq scope-closures
  'dsm-003', // 1900 tap-line data-structure-misuse
  'con-001', // 2000 swipe-binary concurrency
  'inp-001', // 2075 swipe-binary input-validation
]
