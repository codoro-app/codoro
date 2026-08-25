import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Puzzle } from '../../content'

const getPuzzleBodyMock = vi.fn<(id: string) => Promise<Puzzle | undefined>>()

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return { ...actual, getPuzzleBody: getPuzzleBodyMock }
})

const { loadPuzzleBody, resetPuzzleBodyCacheForTests } = await import('./puzzleBodyCache')

function makePuzzle(id: string): Puzzle {
  return {
    id,
    pattern: 'off-by-one',
    difficulty_rating: 1200,
    explanation: `explanation ${id}`,
    prompt: `prompt ${id}`,
    language: 'javascript',
    snippet: 'const x = 1',
    interaction: 'mcq',
    choices: ['a', 'b'],
    correct_choice: 0,
  } as unknown as Puzzle
}

describe('puzzleBodyCache', () => {
  beforeEach(() => {
    getPuzzleBodyMock.mockReset()
    resetPuzzleBodyCacheForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls getPuzzleBody exactly once for a given id, even across multiple loadPuzzleBody calls', async () => {
    const puzzle = makePuzzle('p1')
    getPuzzleBodyMock.mockResolvedValue(puzzle)

    const first = loadPuzzleBody('p1')
    const second = loadPuzzleBody('p1')

    // Same in-flight promise reference — not just "resolves to the same
    // value" — this is what makes a prefetch-then-real-load pair share one
    // network hop instead of racing two.
    expect(first).toBe(second)

    await expect(first).resolves.toBe(puzzle)
    await expect(second).resolves.toBe(puzzle)
    expect(getPuzzleBodyMock).toHaveBeenCalledTimes(1)
    expect(getPuzzleBodyMock).toHaveBeenCalledWith('p1')
  })

  it('calls getPuzzleBody separately for distinct ids', async () => {
    getPuzzleBodyMock.mockImplementation((id) => Promise.resolve(makePuzzle(id)))

    await loadPuzzleBody('a')
    await loadPuzzleBody('b')

    expect(getPuzzleBodyMock).toHaveBeenCalledTimes(2)
    expect(getPuzzleBodyMock).toHaveBeenNthCalledWith(1, 'a')
    expect(getPuzzleBodyMock).toHaveBeenNthCalledWith(2, 'b')
  })

  it('caches an unresolved (undefined) result too — a known-missing id is not re-fetched on every call', async () => {
    getPuzzleBodyMock.mockResolvedValue(undefined)

    await loadPuzzleBody('missing')
    await loadPuzzleBody('missing')

    expect(getPuzzleBodyMock).toHaveBeenCalledTimes(1)
  })

  it('a rejected fetch is cached too — a second call for the same id gets the same rejection, not a fresh attempt', async () => {
    const error = new Error('dynamic import failed')
    getPuzzleBodyMock.mockRejectedValue(error)

    const first = loadPuzzleBody('broken')
    const second = loadPuzzleBody('broken')
    expect(first).toBe(second)

    await expect(first).rejects.toBe(error)
    // Attach a no-op handler to the already-observed promise before
    // asserting call count, so this test itself doesn't produce a spurious
    // unhandled-rejection warning independent of what it's testing.
    await second.catch(() => undefined)
    expect(getPuzzleBodyMock).toHaveBeenCalledTimes(1)
  })

  it('resetPuzzleBodyCacheForTests clears the cache so a subsequent call re-fetches', async () => {
    getPuzzleBodyMock.mockResolvedValue(makePuzzle('p1'))
    await loadPuzzleBody('p1')
    expect(getPuzzleBodyMock).toHaveBeenCalledTimes(1)

    resetPuzzleBodyCacheForTests()
    await loadPuzzleBody('p1')
    expect(getPuzzleBodyMock).toHaveBeenCalledTimes(2)
  })
})
