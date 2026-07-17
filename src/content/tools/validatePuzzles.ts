/**
 * Shared validation core for the content CLI tools: schema-checks every raw
 * puzzle file and enforces the one rule no single file's schema can express
 * on its own — unique `id` across the whole pool.
 */
import { PuzzleSchema } from '../schema'
import type { Puzzle } from '../schema'
import type { RawPuzzleFile } from './loadPuzzles'

export interface ValidatedPuzzle {
  readonly filePath: string
  readonly puzzle: Puzzle
}

export interface ValidationResult {
  readonly valid: readonly ValidatedPuzzle[]
  readonly errors: readonly string[]
}

export function validatePuzzleFiles(files: readonly RawPuzzleFile[]): ValidationResult {
  const valid: ValidatedPuzzle[] = []
  const errors: string[] = []
  const seenIds = new Map<string, string>()

  for (const { filePath, raw } of files) {
    const result = PuzzleSchema.safeParse(raw)
    if (!result.success) {
      for (const issue of result.error.issues) {
        const location = issue.path.length > 0 ? ` (${issue.path.join('.')})` : ''
        errors.push(`${filePath}: ${issue.message}${location}`)
      }
      continue
    }

    const existing = seenIds.get(result.data.id)
    if (existing) {
      errors.push(`${filePath}: duplicate id "${result.data.id}" (also used by ${existing})`)
      continue
    }

    seenIds.set(result.data.id, filePath)
    valid.push({ filePath, puzzle: result.data })
  }

  return { valid, errors }
}
