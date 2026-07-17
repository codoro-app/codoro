/**
 * `pnpm validate:content` — schema-validates every puzzle file under
 * src/content/puzzles/ and enforces pool-wide id uniqueness. Wired into CI
 * (.github/workflows/ci.yml): a bad puzzle fails the build.
 */
import process from 'node:process'
import { loadRawPuzzleFiles } from './loadPuzzles'
import { validatePuzzleFiles } from './validatePuzzles'

function main(): void {
  const files = loadRawPuzzleFiles()
  const { valid, errors } = validatePuzzleFiles(files)

  if (errors.length > 0) {
    console.error(`validate:content: ${String(errors.length)} problem(s) found:\n`)
    for (const error of errors) {
      console.error(`  - ${error}`)
    }
    process.exitCode = 1
    return
  }

  console.log(`validate:content: ${String(valid.length)} puzzle(s) OK`)
}

main()
