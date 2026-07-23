/**
 * `pnpm validate:content` — schema-validates every puzzle file under
 * src/content/puzzles/, enforces pool-wide id uniqueness, and checks the
 * curated daily calendar (src/content/dailyCalendar.ts) against that pool.
 * Wired into CI (.github/workflows/ci.yml): a bad puzzle or calendar entry
 * fails the build.
 */
import process from 'node:process'
import { getDailyNumber } from '../../engine/daily'
import { DAILY_CALENDAR } from '../dailyCalendar'
import { loadRawPuzzleFiles } from './loadPuzzles'
import { validatePuzzleFiles } from './validatePuzzles'

const RUNWAY_WARNING_DAYS = 30

/** Local calendar-date string (YYYY-MM-DD) — matches the app's own convention (see useDailySession.ts). */
function todayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

/** Every calendar id must resolve to a real, valid puzzle, and ids must be unique within the calendar. */
function validateDailyCalendar(validIds: ReadonlySet<string>): string[] {
  const errors: string[] = []
  const seen = new Set<string>()

  DAILY_CALENDAR.forEach((id, index) => {
    if (seen.has(id)) {
      errors.push(`dailyCalendar.ts: duplicate id "${id}" at position ${String(index)}`)
      return
    }
    seen.add(id)

    if (!validIds.has(id)) {
      errors.push(
        `dailyCalendar.ts: entry "${id}" at position ${String(index)} does not match any valid puzzle`,
      )
    }
  })

  return errors
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

function main(): void {
  const files = loadRawPuzzleFiles()
  const { valid, errors } = validatePuzzleFiles(files)
  const validIds = new Set(valid.map((entry) => entry.puzzle.id))
  const allErrors = [...errors, ...validateDailyCalendar(validIds)]

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
    `validate:content: ${String(valid.length)} puzzle(s) OK, ${String(DAILY_CALENDAR.length)} daily-calendar entries OK`,
  )
}

main()
