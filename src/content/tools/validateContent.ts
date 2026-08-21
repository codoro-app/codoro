/**
 * `pnpm validate:content` — schema-validates every puzzle file under
 * src/content/puzzles/, enforces pool-wide id uniqueness, checks the curated
 * daily calendar (src/content/dailyCalendar.ts) against that pool, and applies
 * the Phase 6 v2 DoD library gates (anti-anchoring cluster, quiz language mix,
 * new-content interaction mix). Wired into CI (.github/workflows/ci.yml): a bad
 * puzzle, calendar entry, or out-of-band library state fails the build.
 */
import process from 'node:process'
import { getDailyNumber } from '../../engine/daily'
import { DAILY_CALENDAR } from '../dailyCalendar'
import { BOSS_SETS } from '../bossRun'
import { loadRawPuzzleFiles } from './loadPuzzles'
import {
  findLongSnippetLines,
  SNIPPET_LINE_LENGTH_IDEAL,
  SNIPPET_LINE_LENGTH_MAX,
  validateBossRun,
  validateDailyCalendar,
  validateInteractionMix,
  validateLanguageMix,
  validatePuzzleFiles,
  validateRatingCluster,
} from './validatePuzzles'

const RUNWAY_WARNING_DAYS = 30

/** Local calendar-date string (YYYY-MM-DD) — matches the app's own convention (see useDailySession.ts). */
function todayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

/**
 * Warns (doesn't fail the build) when the calendar is close to running out.
 * Only checked once today's day-index actually falls inside the calendar —
 * pre-launch, with DAILY_EPOCH still a placeholder, every date resolves
 * through the wrap fallback already (dayIndex far past the calendar's
 * length), which is a separate, expected degraded mode, not a runway
 * problem this warning is meant to catch.
 */
function checkDailyCalendarRunway(): void {
  if (DAILY_CALENDAR.length === 0) return

  const dayIndex = getDailyNumber(todayDateString()) - 1
  if (dayIndex < 0 || dayIndex >= DAILY_CALENDAR.length) return

  const runway = DAILY_CALENDAR.length - dayIndex
  if (runway < RUNWAY_WARNING_DAYS) {
    console.warn(
      `validate:content: daily calendar runway is low (${String(runway)} day(s) left) — author more daily-calendar candidates.`,
    )
  }
}

/**
 * Validates every entry in BOSS_SETS (not just index 0), prefixing each
 * error with the set's index so a broken set is traceable back to which
 * one broke — e.g. `bossRun.ts[1]: entry "x-000" ... must escalate`.
 * validateBossRun's own signature/messages are untouched (still take one
 * `bossRun: readonly string[]` and prefix their own messages with
 * `bossRun.ts:`) — this just loops it and rewrites that fixed prefix per
 * set, per the deliberate decision not to change validateBossRun itself.
 */
function validateAllBossSets(valid: Parameters<typeof validateBossRun>[1]): string[] {
  return BOSS_SETS.flatMap((set, index) =>
    validateBossRun(set, valid).map((error) =>
      error.replace(/^bossRun\.ts:/, `bossRun.ts[${String(index)}]:`),
    ),
  )
}

/**
 * Warns (doesn't fail the build) about snippets with over-long lines. Since
 * the 2026-08-21 wrap-don't-scroll change these no longer break anything —
 * they just wrap, costing the one-line-per-statement shape that makes a bug
 * spottable at a glance. See findLongSnippetLines' doc comment for where the
 * threshold comes from. Printed after the success line, capped at the worst
 * few so a large backlog doesn't bury the actual result.
 */
const SNIPPET_WARNING_SAMPLE = 8

function checkSnippetLineLengths(valid: Parameters<typeof findLongSnippetLines>[0]): void {
  const warnings = findLongSnippetLines(valid)
  if (warnings.length === 0) return

  console.warn(
    `\nvalidate:content: ${String(warnings.length)} of ${String(valid.length)} puzzle(s) have a snippet line over ${String(SNIPPET_LINE_LENGTH_MAX)} chars — these wrap to 3+ rows on a phone (~${String(SNIPPET_LINE_LENGTH_IDEAL)} chars fit on one row). Reformat when you next touch them:`,
  )
  for (const { filePath, id, longestLine } of warnings.slice(0, SNIPPET_WARNING_SAMPLE)) {
    console.warn(`  - ${id} (${String(longestLine)} chars) ${filePath}`)
  }
  if (warnings.length > SNIPPET_WARNING_SAMPLE) {
    console.warn(`  ...and ${String(warnings.length - SNIPPET_WARNING_SAMPLE)} more.`)
  }
}

function main(): void {
  const files = loadRawPuzzleFiles()
  const { valid, errors } = validatePuzzleFiles(files)
  const allErrors = [
    ...errors,
    ...validateDailyCalendar(DAILY_CALENDAR, valid),
    ...validateAllBossSets(valid),
    ...validateRatingCluster(valid),
    ...validateLanguageMix(valid),
    ...validateInteractionMix(valid),
  ]

  if (allErrors.length > 0) {
    console.error(`validate:content: ${String(allErrors.length)} problem(s) found:\n`)
    for (const error of allErrors) {
      console.error(`  - ${error}`)
    }
    process.exitCode = 1
    return
  }

  checkDailyCalendarRunway()
  console.log(
    `validate:content: ${String(valid.length)} puzzle(s) OK, ${String(DAILY_CALENDAR.length)} daily-calendar entries OK, ${String(BOSS_SETS.length)} boss set(s) OK`,
  )
  checkSnippetLineLengths(valid)
}

main()
