/**
 * `pnpm validate:explanations` — validates every file under
 * src/content/explanations/ against the real puzzle pool. Wired into
 * `pnpm validate` and CI beside `validateContent.ts`. See
 * docs/superpowers/plans/2026-09-19-wrong-answer-explanations-spec.md §8 for
 * the seven failure conditions this enforces.
 *
 * Two validation layers, mirroring validateContent.ts/validatePuzzles.ts's
 * own split: `ExplanationSetSchema.safeParse` (self-contained — shape,
 * length bounds, duplicate targets, the ordinal-reference regex, the
 * swipe-binary single-entry/target-0 shape) plus the cross-file checks below
 * that need the real puzzle pool (unknown puzzle_id, out-of-range target,
 * an entry on the correct answer, missing coverage).
 */
import process from 'node:process'
import { ExplanationSetSchema } from '../explanationSchema'
import type { ExplanationSet } from '../explanationSchema'
import type { Puzzle } from '../schema'
import { loadRawPuzzleFiles } from './loadPuzzles'
import { validatePuzzleFiles } from './validatePuzzles'
import type { ValidatedPuzzle } from './validatePuzzles'
import { loadRawExplanationFiles } from './loadExplanations'
import type { RawExplanationFile } from './loadExplanations'
import { wrongTargetsFor } from './explanationTargets'

interface ValidatedExplanationSet {
  readonly filePath: string
  readonly set: ExplanationSet
}

interface ExplanationValidationResult {
  readonly valid: readonly ValidatedExplanationSet[]
  readonly errors: readonly string[]
}

function validateExplanationFiles(
  files: readonly RawExplanationFile[],
): ExplanationValidationResult {
  const valid: ValidatedExplanationSet[] = []
  const errors: string[] = []
  const seenPuzzleIds = new Map<string, string>()

  for (const { filePath, raw } of files) {
    const result = ExplanationSetSchema.safeParse(raw)
    if (!result.success) {
      for (const issue of result.error.issues) {
        const location = issue.path.length > 0 ? ` (${issue.path.join('.')})` : ''
        errors.push(`${filePath}: ${issue.message}${location}`)
      }
      continue
    }

    const existing = seenPuzzleIds.get(result.data.puzzle_id)
    if (existing) {
      errors.push(
        `${filePath}: duplicate puzzle_id "${result.data.puzzle_id}" (also used by ${existing})`,
      )
      continue
    }

    seenPuzzleIds.set(result.data.puzzle_id, filePath)
    valid.push({ filePath, set: result.data })
  }

  return { valid, errors }
}

/** Only mcq/tap-line explanations are required this phase — swipe-binary is optional (spec §10/DoD: "may ride along"). */
const COVERAGE_REQUIRED_INTERACTIONS: readonly Puzzle['interaction'][] = ['mcq', 'tap-line']

/**
 * Cross-file checks that need the real puzzle pool — spec §8 items 1
 * (unknown puzzle_id), 2 (target out of range), 4 (target on the correct
 * answer), and 5 (missing coverage, mcq/tap-line only).
 */
function crossCheckAgainstPool(
  explanationSets: readonly ValidatedExplanationSet[],
  puzzles: readonly ValidatedPuzzle[],
): string[] {
  const errors: string[] = []
  const puzzleById = new Map(puzzles.map((entry) => [entry.puzzle.id, entry.puzzle]))

  for (const { filePath, set } of explanationSets) {
    const puzzle = puzzleById.get(set.puzzle_id)
    if (!puzzle) {
      errors.push(`${filePath}: puzzle_id "${set.puzzle_id}" does not match any real puzzle`)
      continue
    }

    if (puzzle.interaction !== set.interaction) {
      errors.push(
        `${filePath}: interaction "${set.interaction}" does not match puzzle ${puzzle.id}'s actual interaction "${puzzle.interaction}"`,
      )
      continue
    }

    const wrongTargets = wrongTargetsFor(puzzle)
    if (wrongTargets === null) {
      errors.push(
        `${filePath}: puzzle ${puzzle.id} has interaction "${puzzle.interaction}", which this pipeline does not explain`,
      )
      continue
    }
    const validTargets = new Set(wrongTargets)
    const correctTarget =
      puzzle.interaction === 'mcq'
        ? puzzle.correct_choice
        : puzzle.interaction === 'tap-line'
          ? puzzle.correct_line
          : null

    for (const entry of set.entries) {
      if (correctTarget !== null && entry.target === correctTarget) {
        errors.push(
          `${filePath}: entry targets ${String(entry.target)}, which is puzzle ${puzzle.id}'s CORRECT answer — an entry must never explain a right answer`,
        )
        continue
      }
      if (!validTargets.has(entry.target)) {
        errors.push(
          `${filePath}: target ${String(entry.target)} is out of range for puzzle ${puzzle.id} (valid targets: ${wrongTargets.join(', ')})`,
        )
      }
    }
  }

  const setByPuzzleId = new Map(explanationSets.map((entry) => [entry.set.puzzle_id, entry.set]))

  for (const { puzzle } of puzzles) {
    if (!COVERAGE_REQUIRED_INTERACTIONS.includes(puzzle.interaction)) continue

    const wrongTargets = wrongTargetsFor(puzzle) ?? []
    const set = setByPuzzleId.get(puzzle.id)
    if (!set) {
      errors.push(
        `${puzzle.id}: missing explanation file — every ${puzzle.interaction} puzzle must have one`,
      )
      continue
    }

    const covered = new Set(set.entries.map((entry) => entry.target))
    const missing = wrongTargets.filter((target) => !covered.has(target))
    if (missing.length > 0) {
      errors.push(
        `${puzzle.id}: explanation file is missing entries for target(s) ${missing.join(', ')} (${String(wrongTargets.length)} wrong answer(s) expected, ${String(set.entries.length)} entries present)`,
      )
    }
  }

  return errors
}

function main(): void {
  const { valid: validExplanations, errors: schemaErrors } =
    validateExplanationFiles(loadRawExplanationFiles())

  const { valid: validPuzzles, errors: puzzleErrors } = validatePuzzleFiles(loadRawPuzzleFiles())
  if (puzzleErrors.length > 0) {
    console.error(
      `validate:explanations: the puzzle pool itself is invalid — fix \`pnpm validate:content\` first before explanations can be checked against it:\n`,
    )
    for (const error of puzzleErrors) {
      console.error(`  - ${error}`)
    }
    process.exitCode = 1
    return
  }

  const allErrors = [...schemaErrors, ...crossCheckAgainstPool(validExplanations, validPuzzles)]

  if (allErrors.length > 0) {
    console.error(`validate:explanations: ${String(allErrors.length)} problem(s) found:\n`)
    for (const error of allErrors) {
      console.error(`  - ${error}`)
    }
    process.exitCode = 1
    return
  }

  console.log(`validate:explanations: ${String(validExplanations.length)} explanation set(s) OK`)
}

main()
