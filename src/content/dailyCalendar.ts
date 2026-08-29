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
 *
 * Fix-wave amendment (2026-08-29, final whole-branch review, findings
 * I1-I3): dropped to 37 entries. `tc-026` and `inp-014` (both drag-order)
 * are excluded — their own `explanation` fields admit the stored
 * `correct_order` isn't the only valid ordering, which `DragOrder.tsx`'s
 * exact-positional scoring would mark wrong for an equally-correct
 * alternate answer. Both puzzle files are left in place as valid,
 * non-Daily general-pool content. The remaining 37 are also reordered:
 * the original pure difficulty-descending sort produced three long
 * same-interaction runs (9 drag-order, 6 tap-line, 11 scrubber) and two
 * adjacent same-bug pairs (oob-025/oob-026; scl-024/scl-025). Below,
 * same-difficulty (1700) entries round-robin across interaction types
 * instead of blocking by type, and two of the 1700-tier tap-line entries
 * (cf-032, res-016) are placed slightly later than strict rating order to
 * split the otherwise-homogeneous scrubber-only 1650/1625/1600 tail into
 * runs of at most 4 — this is the only place ordering isn't strictly
 * difficulty-descending, and it's a two-place, same-tier-adjacent nudge,
 * not a reshuffle. No run of any interaction type exceeds 4 consecutive
 * entries anywhere, and the two named pairs are no longer adjacent.
 */
export const DAILY_CALENDAR: readonly string[] = [
  'inp-015', // 2100 tap-line input-validation
  'nul-013', // 1950 tap-line null-undefined
  'con-014', // 1900 drag-order concurrency
  'con-015', // 1900 tap-line concurrency
  'dsm-025', // 1800 scrubber data-structure-misuse
  'tc-027', // 1800 tap-line type-coercion
  'rec-028', // 1800 tap-line recursion-termination
  'err-018', // 1800 tap-line error-handling
  'rec-027', // 1700 drag-order recursion-termination
  'mut-025', // 1700 scrubber mutable-state
  'err-017', // 1700 drag-order error-handling
  'scl-027', // 1700 tap-line scope-closures
  'scl-026', // 1700 drag-order scope-closures
  'tc-025', // 1700 scrubber type-coercion
  'mut-027', // 1700 drag-order mutable-state
  'mut-028', // 1700 tap-line mutable-state
  'res-015', // 1700 drag-order resource-management
  'cf-029', // 1700 scrubber control-flow
  'dsm-027', // 1700 drag-order data-structure-misuse
  'str-015', // 1700 tap-line string-formatting
  'nul-012', // 1700 drag-order null-undefined
  'rec-026', // 1700 scrubber recursion-termination
  'str-014', // 1700 drag-order string-formatting
  'dsm-028', // 1700 tap-line data-structure-misuse
  'oob-024', // 1650 scrubber off-by-one
  'tc-024', // 1650 scrubber type-coercion
  'mut-024', // 1625 scrubber mutable-state
  'mut-026', // 1625 scrubber mutable-state
  'cf-032', // 1700 tap-line control-flow
  'oob-025', // 1600 scrubber off-by-one
  'scl-024', // 1600 scrubber scope-closures
  'oob-026', // 1600 scrubber off-by-one
  'scl-025', // 1600 scrubber scope-closures
  'res-016', // 1700 tap-line resource-management
  'cf-030', // 1600 scrubber control-flow
  'rec-025', // 1600 scrubber recursion-termination
  'dsm-026', // 1600 scrubber data-structure-misuse
]
