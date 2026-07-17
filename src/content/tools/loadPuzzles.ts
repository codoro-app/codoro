/**
 * Node-side file walking for the content CLI tools (validateContent.ts,
 * contentStats.ts). Reads straight off disk via `fs` — never imported by
 * app code, which instead reads validated content through index.ts's
 * `import.meta.glob` pool at build time. Keeping these paths separate means
 * a Node-only import never has a chance to end up in the Vite bundle.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PUZZLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'puzzles')

export interface RawPuzzleFile {
  readonly filePath: string
  readonly raw: unknown
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      return walk(fullPath)
    }
    return entry.name.endsWith('.json') ? [fullPath] : []
  })
}

/**
 * Reads and JSON.parses every puzzle file under src/content/puzzles/.
 * Returns an empty array if the directory doesn't exist yet (no puzzles
 * authored yet is a valid state, not an error). Throws on unreadable or
 * malformed JSON — that's always a real authoring mistake, never something
 * to silently skip.
 */
export function loadRawPuzzleFiles(): RawPuzzleFile[] {
  if (!existsSync(PUZZLES_DIR)) {
    return []
  }

  return walk(PUZZLES_DIR)
    .sort()
    .map((filePath) => {
      const text = readFileSync(filePath, 'utf-8')
      try {
        return { filePath, raw: JSON.parse(text) as unknown }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`${filePath}: invalid JSON (${message})`, { cause: err })
      }
    })
}
