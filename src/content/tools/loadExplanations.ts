/**
 * Node-side file reading for validateExplanations.ts — mirrors
 * loadPuzzles.ts's loadRawPuzzleFiles, but flat (src/content/explanations/
 * has no pattern subdirectories, unlike src/content/puzzles/ — see the
 * spec's §3.1 "one file per puzzle, flat, named by puzzle id").
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPLANATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'explanations')

export interface RawExplanationFile {
  readonly filePath: string
  readonly raw: unknown
}

/**
 * Reads and JSON.parses every file under src/content/explanations/. Returns
 * an empty array if the directory doesn't exist yet (no explanations
 * authored yet is a valid state, not an error). Throws on unreadable or
 * malformed JSON — always a real authoring mistake, never something to
 * silently skip.
 */
export function loadRawExplanationFiles(): RawExplanationFile[] {
  if (!existsSync(EXPLANATIONS_DIR)) {
    return []
  }

  return readdirSync(EXPLANATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const filePath = join(EXPLANATIONS_DIR, name)
      const text = readFileSync(filePath, 'utf-8')
      try {
        return { filePath, raw: JSON.parse(text) as unknown }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`${filePath}: invalid JSON (${message})`, { cause: err })
      }
    })
}
