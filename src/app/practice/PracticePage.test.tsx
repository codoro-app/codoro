import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { decodeChallengePayload } from '../../challenge'
import { PATTERN_LABELS } from '../../content'
import { nth } from '../../test/nth'
import type { Attempt, UserProfile } from '../../storage'

// Counts real selectNext calls — the "puzzle actually served" churn that a
// runaway pattern-filter effect (v2 Phase 1b corrective, Finding 1) would
// multiply without bound. Wraps the real implementation (not a stub) so the
// counter reflects genuine serveNext activity, same spirit as this file's
// other importOriginal mocks below. Also records each call's pool (ids
// only) — selectNext's actual pick uses real Math.random(), so asserting on
// which puzzle got served is non-deterministic; the pool argument itself is
// deterministic and is what the combined-filter test below checks instead.
const { selectNextCalls } = vi.hoisted(() => ({
  selectNextCalls: { count: 0, pools: [] as string[][] },
}))

vi.mock('../../engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine')>()
  return {
    ...actual,
    selectNext: (...args: Parameters<typeof actual.selectNext>) => {
      selectNextCalls.count += 1
      selectNextCalls.pools.push(args[0].pool.map((p) => p.id))
      return actual.selectNext(...args)
    },
  }
})

const practicePagePath = join(dirname(fileURLToPath(import.meta.url)), 'PracticePage.tsx')

const { FIXTURE_POOL, FIXTURE_BODY_BY_ID } = vi.hoisted(() => {
  const pool = Array.from({ length: 12 }, (_, i) => ({
    id: `p${String(i)}`,
    pattern: i % 2 === 0 ? 'off-by-one' : 'null-undefined',
    difficulty_rating: 1150 + i * 10,
    explanation: `explanation ${String(i)}`,
    prompt: `prompt ${String(i)}`,
    language: 'javascript',
    snippet: 'const x = 1',
    interaction: 'mcq',
    choices: ['a', 'b'],
    correct_choice: 0,
  }))
  return { FIXTURE_POOL: pool, FIXTURE_BODY_BY_ID: new Map(pool.map((p) => [p.id, p])) }
})

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  // puzzleMeta needs the same override as puzzlePool/quizPool (perf pass,
  // 2026-08-24) — MasteryTeaser now reads puzzleMeta, not puzzlePool, to
  // compute mastery; without this the fixture ids (p0/p1/...) never resolve
  // to a pattern via the real (unmocked) puzzleMeta, and any test exercising
  // MasteryTeaser inside PracticePage silently never sees an accuracy update.
  // getPuzzleBody: usePracticeSession now loads puzzle bodies on demand
  // (content-metadata-lazy-load Task 5) — without this override, real
  // getPuzzleBody would look for these fixture ids among real on-disk
  // content and never find them.
  return {
    ...actual,
    puzzlePool: FIXTURE_POOL,
    quizPool: FIXTURE_POOL,
    puzzleMeta: FIXTURE_POOL,
    // Derived exports must be re-derived from the SAME fixture, not left
    // real — see usePracticeSession.test.ts's identical mock comment.
    quizMeta: FIXTURE_POOL.filter((meta) => meta.interaction !== 'scrubber'),
    scrubberMeta: FIXTURE_POOL.filter((meta) => meta.interaction === 'scrubber'),
    getPuzzleBody: vi.fn((id: string) => Promise.resolve(FIXTURE_BODY_BY_ID.get(id))),
  }
})

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return {
    ...actual,
    loadProfile: vi.fn(),
    saveProfile: vi.fn(),
    appendAttempt: vi.fn(),
    listAttempts: vi.fn(),
  }
})

vi.mock('../../telemetry', () => ({
  trackPracticeAttempt: vi.fn(),
  trackComboShieldUsed: vi.fn(),
  trackStreakPause: vi.fn(),
  trackAutoAdvance: vi.fn(),
  trackShareClick: vi.fn(),
  trackChallengeCreate: vi.fn(),
  trackError: vi.fn(),
}))

const { loadProfile, saveProfile, appendAttempt, listAttempts, createDefaultProfile } =
  await import('../../storage')
const { trackShareClick, trackChallengeCreate } = await import('../../telemetry')
const { PracticePage } = await import('./PracticePage')
const { resetPuzzleBodyCacheForTests } = await import('./puzzleBodyCache')

describe('PracticePage', () => {
  beforeEach(() => {
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
    vi.mocked(listAttempts).mockResolvedValue([])
    resetPuzzleBodyCacheForTests()
    // /browse is a real route now (v2 Phase 1a) — PracticePage reads it via
    // wouter's useLocation, which (unlike component state) reads the real
    // window.location and survives across tests in this file. Reset to
    // /practice so every test starts from the non-browse view, matching
    // what these tests assumed before the extraction.
    window.history.pushState({}, '', '/practice')
    selectNextCalls.count = 0
    selectNextCalls.pools = []
  })

  it('keys the rendered PuzzleCardShell by puzzle.id (required concern-b fix)', () => {
    const source = readFileSync(practicePagePath, 'utf-8')
    expect(source).toMatch(/<PuzzleCardShell[\s\S]{0,40}key=\{session\.puzzle\.id\}/)
  })

  it('loads a puzzle and renders the status bar + card after startup', async () => {
    render(<PracticePage />)

    expect(screen.getByTestId('route-skeleton')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })
    // Rating pill shows the default starting rating.
    expect(screen.getByText('1200')).toBeInTheDocument()
  })

  it('reveals a share menu after answering, firing share_click on copy, then hides it once Continue serves a new puzzle', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()

    await user.click(nth(screen.getAllByRole('button', { name: 'a' }), 0))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Share' }))

    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    await user.click(screen.getByRole('button', { name: 'Share puzzle' }))
    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('Codoro Practice —'))
    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('getcodoro.com/puzzle/'))
    expect(trackShareClick).toHaveBeenCalledTimes(1)
    expect(trackShareClick).toHaveBeenCalledWith(expect.objectContaining({ surface: 'practice' }))

    await user.click(screen.getByRole('button', { name: 'Next puzzle' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
    })
  })

  it('shows a working "Challenge a friend" button after a correct answer that re-encodes the streak, prompting for a name on first use', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    // Unlike the old streak-gated "Share challenge" row, ChallengeButton is
    // not folded into the "Share" sheet at all — it's its own always-visible
    // control, absent only until an answer exists.
    expect(screen.queryByRole('button', { name: /challenge a friend/i })).not.toBeInTheDocument()

    await user.click(nth(screen.getAllByRole('button', { name: 'a' }), 0))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /challenge a friend/i })).toBeInTheDocument()
    })

    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    // This file's beforeEach has no vi.clearAllMocks(), so a spy placed in
    // an earlier test (the share-menu test's "Share puzzle" click) may
    // still be the same accumulated spy — clear it so calls[0] is this
    // test's own write, not a leftover.
    writeTextSpy.mockClear()
    await user.click(screen.getByRole('button', { name: /challenge a friend/i }))

    // No saved name yet on a fresh default profile — the name-prompt sheet
    // opens first; "Skip" sends immediately with no name (never blocks
    // sharing, per the design record).
    expect(screen.getByRole('dialog', { name: 'Your name' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(trackChallengeCreate).toHaveBeenCalledTimes(1)
    expect(trackChallengeCreate).toHaveBeenCalledWith({ surface: 'practice', puzzle_count: 1 })

    const url = writeTextSpy.mock.calls[0]?.[0]
    if (typeof url !== 'string')
      throw new Error('expected writeText to have been called with a URL')
    expect(url).toMatch(/^Can you beat my streak of 1\? getcodoro\.com\/challenge#/)

    const decoded = decodeChallengePayload(url.split('#')[1] ?? '')
    expect(decoded).not.toBeNull()
    expect(decoded?.ids).toHaveLength(1)
    expect(decoded?.challengerName).toBeNull()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Link copied!' })).toBeInTheDocument()
    })
  })

  it('challenges just the single just-answered puzzle (not the empty streak) after a wrong answer', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    // Every fixture puzzle's correct_choice is 0 ('a') — 'b' is always wrong.
    await user.click(nth(screen.getAllByRole('button', { name: 'b' }), 0))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /challenge a friend/i })).toBeInTheDocument()
    })

    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    writeTextSpy.mockClear()
    await user.click(screen.getByRole('button', { name: /challenge a friend/i }))
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(trackChallengeCreate).toHaveBeenCalledWith({ surface: 'practice', puzzle_count: 1 })
    const url = writeTextSpy.mock.calls[0]?.[0]
    if (typeof url !== 'string')
      throw new Error('expected writeText to have been called with a URL')
    // The empty streak (a miss clears it) falls back to "beat this one" —
    // never a 0-puzzle streak challenge.
    expect(url).toMatch(/^Can you beat this one\? getcodoro\.com\/challenge#/)
    const decoded = decodeChallengePayload(url.split('#')[1] ?? '')
    expect(decoded?.ids).toHaveLength(1)
    expect(decoded?.results[0]?.correct).toBe(false)
  })

  it('clears the share menu on Continue — it must not persist under the next, unanswered puzzle', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    await user.click(nth(screen.getAllByRole('button', { name: 'a' }), 0))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Next puzzle' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
    })
  })

  it('browse-by-pattern: selecting a pattern filters subsequent puzzles and shows a way back to all patterns', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('link', { name: /browse patterns/i }))
    expect(screen.getByText(PATTERN_LABELS['null-undefined'])).toBeInTheDocument()

    await user.click(screen.getByText(PATTERN_LABELS['null-undefined']))

    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`filtering: ${PATTERN_LABELS['null-undefined']}`, 'i')),
      ).toBeInTheDocument()
    })
    // Browse button itself stays a static label now — the active pattern is
    // shown by the dedicated filter chip instead.
    expect(screen.getByRole('link', { name: /^browse patterns/i })).toBeInTheDocument()

    // Practice-all-patterns escape hatch is still reachable via Browse.
    await user.click(screen.getByRole('link', { name: /^browse patterns/i }))
    expect(screen.getByRole('button', { name: /practice all patterns/i })).toBeInTheDocument()
  })

  it('applies a ?pattern= query param as the filter on load (the /puzzle/:id "practice more like this" CTA\'s destination)', async () => {
    window.history.pushState({}, '', '/practice?pattern=null-undefined')
    render(<PracticePage />)

    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`filtering: ${PATTERN_LABELS['null-undefined']}`, 'i')),
      ).toBeInTheDocument()
    })
  })

  // Finding 1 (v2 Phase 1b corrective, P0): the effect applying ?pattern=
  // used to depend on session.setPatternFilter, whose identity churns on
  // every call (serveNext always creates a new profile object) — an
  // infinite render loop, measured at 247 setPatternFilter calls in 400ms
  // of instrumented idle time before this fix. A waitFor() on "does the
  // chip appear" (the test above) cannot detect this: the chip appears on
  // the *first* iteration and the test ends before observing the loop
  // never stops. This asserts a *count*, across a settling delay, instead.
  it('applies the ?pattern= filter exactly once — asserted by call count over a settling delay, not just presence', async () => {
    window.history.pushState({}, '', '/practice?pattern=null-undefined')
    render(<PracticePage />)

    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`filtering: ${PATTERN_LABELS['null-undefined']}`, 'i')),
      ).toBeInTheDocument()
    })

    // Exactly two real serves: the initial unfiltered mount serve, then the
    // one filtered serve the pattern-filter effect triggers. The original
    // bug kept calling setPatternFilter (and therefore selectNext) well
    // past this point.
    expect(selectNextCalls.count).toBe(2)

    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(selectNextCalls.count).toBe(2)
  })

  // The naive fix for Finding 1 — latching "applied" on the very first
  // effect run — is wrong: setPatternFilter no-ops while session.profile is
  // still null (loadProfile hasn't resolved yet on that first run), so a
  // bare latch marks the pattern "applied" on a no-op and the filter is
  // then never actually applied. This defers loadProfile's resolution to
  // prove the filter still applies once profile becomes available on a
  // later tick — reverting the profile gate (keeping only the latch) turns
  // this test red with a 5s waitFor timeout.
  it('still applies the ?pattern= filter once session.profile resolves on a later tick (naive-latch regression guard)', async () => {
    let resolveLoadProfile: ((profile: UserProfile) => void) | undefined
    vi.mocked(loadProfile).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoadProfile = resolve
        }),
    )
    window.history.pushState({}, '', '/practice?pattern=null-undefined')
    render(<PracticePage />)

    // Still loading — session.profile is null, so the effect must not have
    // latched "applied" yet.
    expect(screen.getByTestId('route-skeleton')).toBeInTheDocument()

    resolveLoadProfile?.(createDefaultProfile())

    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`filtering: ${PATTERN_LABELS['null-undefined']}`, 'i')),
      ).toBeInTheDocument()
    })
  })

  it('ignores an unrecognized ?pattern= value and falls back to the unfiltered pool', async () => {
    window.history.pushState({}, '', '/practice?pattern=not-a-real-pattern')
    render(<PracticePage />)

    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/filtering: /i)).not.toBeInTheDocument()
  })

  it('applies the ?interaction= filter from the URL (Phase 5 Item 4)', async () => {
    window.history.pushState({}, '', '/practice?interaction=mcq')
    render(<PracticePage />)

    await waitFor(() => {
      expect(screen.getByText(/filtering: multiple choice/i)).toBeInTheDocument()
    })
    // Every fixture puzzle is mcq, so the filter is a no-op on content —
    // this only proves the param was read and applied, not that filtering works.
    expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
  })

  it('ignores an unrecognized ?interaction= value and falls back to the unfiltered pool', async () => {
    window.history.pushState({}, '', '/practice?interaction=not-a-real-interaction')
    render(<PracticePage />)

    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/filtering: /i)).not.toBeInTheDocument()
  })

  it('applies ?pattern= and ?interaction= together as one combined filter, not two independent serveNext calls', async () => {
    // Revert check for the setFilters fix: calling setPatternFilter then
    // setInteractionFilter back to back in one effect (no render between
    // them) each closes over the OTHER filter's stale value, so the second
    // call's serveNext silently drops the first filter from the pool passed
    // to selectNext — even though both filter values end up correct in
    // state. Asserting on which puzzle got SERVED isn't a reliable check
    // here: selectNext uses real Math.random(), and every fixture puzzle is
    // 'mcq', so an interaction=mcq-only (pattern dropped) pool still
    // contains a valid answer some of the time by chance. The pool actually
    // passed to selectNext is deterministic and is what this checks
    // instead (via the selectNext mock above).
    window.history.pushState({}, '', '/practice?pattern=off-by-one&interaction=mcq')
    render(<PracticePage />)

    await waitFor(() => {
      expect(
        screen.getByText(
          new RegExp(`filtering: multiple choice \\+ ${PATTERN_LABELS['off-by-one']}`, 'i'),
        ),
      ).toBeInTheDocument()
    })

    const lastPool = selectNextCalls.pools.at(-1)
    if (!lastPool) throw new Error('expected at least one selectNext call')
    expect(lastPool.length).toBeGreaterThan(0)
    // Even-indexed fixture puzzles (p0, p2, ...) are 'off-by-one';
    // odd-indexed are 'null-undefined'. The pool must contain only the
    // pattern-matching half — if it were the full 12 (pattern silently
    // dropped, per the double-dispatch bug), this fails.
    for (const id of lastPool) {
      const index = Number(id.replace('p', ''))
      expect(index % 2).toBe(0)
    }
  })

  it('shows a named empty state (not a stall or crash) when a pattern+interaction combination has zero content', async () => {
    // Every fixture puzzle is mcq — off-by-one + swipe-binary is a real,
    // valid combination with no matching content.
    window.history.pushState({}, '', '/practice?pattern=off-by-one&interaction=swipe-binary')
    render(<PracticePage />)

    await waitFor(() => {
      expect(
        screen.getByText(
          new RegExp(`no puzzles available for swipe \\+ ${PATTERN_LABELS['off-by-one']}`, 'i'),
        ),
      ).toBeInTheDocument()
    })
    expect(screen.queryByText(/prompt \d/)).not.toBeInTheDocument()
  })

  it('an interaction chip toggles the filter on click and clears it on a second click', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    const mcqChip = screen.getByRole('button', { name: 'Multiple choice' })
    expect(mcqChip).toHaveAttribute('aria-pressed', 'false')

    await user.click(mcqChip)
    expect(mcqChip).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => {
      expect(screen.getByText(/filtering: multiple choice/i)).toBeInTheDocument()
    })

    await user.click(mcqChip)
    expect(mcqChip).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText(/filtering: /i)).not.toBeInTheDocument()
  })

  it('the filter chip clears the pattern filter directly, without losing session stats', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    // Solve one puzzle first, so solvedThisSession is non-zero before filtering.
    await user.click(nth(screen.getAllByRole('button', { name: 'a' }), 0))
    await user.click(screen.getByRole('button', { name: 'Next puzzle' }))
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
    expect(screen.getByText(/1 solved this session/i)).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /browse patterns/i }))
    await user.click(screen.getByText(PATTERN_LABELS['null-undefined']))
    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`filtering: ${PATTERN_LABELS['null-undefined']}`, 'i')),
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(screen.queryByText(/filtering: /i)).not.toBeInTheDocument()
    // Session stat survived the clear — this was a pure filter swap, not a reset.
    expect(screen.getByText(/1 solved this session/i)).toBeInTheDocument()
    // Still on the practice view (a puzzle card is showing), not the picker.
    expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
  })

  it('while filtered, selecting a different pattern from Browse switches the filter rather than stacking', async () => {
    // Was previously exercised via a mastery-row click (a second, now-retired
    // entry point into setPatternFilter); Browse is the only pattern-picking
    // UI left on mobile after 2b.7's MasteryTeaser swap, so this asserts the
    // same underlying "replace, don't stack" filter behavior through it.
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('link', { name: /browse patterns/i }))
    await user.click(screen.getByText(PATTERN_LABELS['null-undefined']))
    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`filtering: ${PATTERN_LABELS['null-undefined']}`, 'i')),
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole('link', { name: /^browse patterns/i }))
    await user.click(screen.getByText(PATTERN_LABELS['off-by-one']))

    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`filtering: ${PATTERN_LABELS['off-by-one']}`, 'i')),
      ).toBeInTheDocument()
    })
    // The old filter is gone, not stacked alongside the new one.
    expect(
      screen.queryByText(new RegExp(`filtering: ${PATTERN_LABELS['null-undefined']}`, 'i')),
    ).not.toBeInTheDocument()
  })

  it('answering and continuing serves a fresh, unanswered card', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    await user.click(nth(screen.getAllByRole('button', { name: 'a' }), 0))
    expect(screen.getByRole('status')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next puzzle' }))
    // AnimatePresence keeps the outgoing (answered) card mounted until its
    // exit transition finishes — real wall-clock time, not a synchronous
    // state flush — so wait for it to actually leave the DOM.
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  it('scrolls the puzzle card into view when a new puzzle is served (Continue and pattern-filter switch)', async () => {
    const user = userEvent.setup()
    // The question can sit well below the page top on mobile (StatusBar +
    // Browse-patterns/Mastery links + filter chips all render above the
    // card) — a bare `window.scrollTo({ top: 0 })` still leaves it below the
    // fold, so the puzzle card itself, not the page top, is the real scroll
    // target. jsdom (this project's version) doesn't implement
    // `scrollIntoView` at all — `vi.spyOn` requires the property to already
    // exist, so assign a plain mock function directly instead. `window.
    // scrollTo` stays mocked too: it's still the fallback for when the card
    // ref isn't available (loading/error/empty states).
    const scrollIntoViewSpy = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    // The card is off-screen (scrolled above the viewport, mirroring the
    // 2026-08-18 "new shorter puzzle" bug this effect exists to fix) so the
    // scroll-if-out-of-view gate below still lets this test exercise the
    // scrolls-when-needed branch.
    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ top: -80 } as DOMRect)

    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })
    // The initial serve on mount also counts as "a puzzle was served". The
    // scroll-reset effect is a separate (passive) effect from the one that
    // renders the prompt text, so it can flush a tick later — wait for the
    // spy directly rather than assuming it landed by the time the text did.
    await waitFor(() => {
      expect(scrollIntoViewSpy).toHaveBeenCalledWith({ block: 'start' })
    })
    scrollIntoViewSpy.mockClear()

    await user.click(nth(screen.getAllByRole('button', { name: 'a' }), 0))
    await user.click(screen.getByRole('button', { name: 'Next puzzle' }))
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(scrollIntoViewSpy).toHaveBeenCalledWith({ block: 'start' })
    })
    scrollIntoViewSpy.mockClear()

    await user.click(screen.getByRole('link', { name: /browse patterns/i }))
    await user.click(screen.getByText(PATTERN_LABELS['null-undefined']))
    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`filtering: ${PATTERN_LABELS['null-undefined']}`, 'i')),
      ).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(scrollIntoViewSpy).toHaveBeenCalledWith({ block: 'start' })
    })

    // @ts-expect-error -- deleting the mock so other test files see jsdom's
    // real (missing) scrollIntoView again, not this one's mock leaking out.
    delete HTMLElement.prototype.scrollIntoView
    scrollToSpy.mockRestore()
    getBoundingClientRectSpy.mockRestore()
  })

  it('does not scroll the puzzle card into view when it is already fully visible (todo 25 regression)', async () => {
    // Regression coverage for the desktop "Practice tab scrolling down on
    // every puzzle" defect: previously this effect force-scrolled the card
    // to the viewport top on every puzzleId change even when the card was
    // already fully on-screen, pushing StatusBar/Browse-patterns/filter-chip
    // rows (which render above the card) out of view on every transition.
    const user = userEvent.setup()
    const scrollIntoViewSpy = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    // Already fully visible: top is within [0, window.innerHeight).
    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ top: 120 } as DOMRect)

    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    await user.click(nth(screen.getAllByRole('button', { name: 'a' }), 0))
    await user.click(screen.getByRole('button', { name: 'Next puzzle' }))
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    expect(scrollIntoViewSpy).not.toHaveBeenCalled()
    expect(scrollToSpy).not.toHaveBeenCalled()

    // @ts-expect-error -- deleting the mock so other test files see jsdom's
    // real (missing) scrollIntoView again, not this one's mock leaking out.
    delete HTMLElement.prototype.scrollIntoView
    scrollToSpy.mockRestore()
    getBoundingClientRectSpy.mockRestore()
  })

  it('a load failure renders a friendly error with a working retry (not a stuck loading state)', async () => {
    const user = userEvent.setup()
    vi.mocked(loadProfile).mockRejectedValueOnce(new Error('IndexedDB blocked'))

    render(<PracticePage />)

    await waitFor(() => {
      expect(screen.getByText(/couldn.t load your practice session/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()

    vi.mocked(loadProfile).mockResolvedValueOnce(createDefaultProfile())
    await user.click(screen.getByRole('button', { name: /try again/i }))

    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })
  })

  it('mobile "Mastery" nav view shows the same teaser and a link to /stats', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Mastery' }))

    const link = await screen.findByRole('link', { name: /view full stats/i })
    expect(link).toHaveAttribute('href', '/stats')

    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
  })

  it('shows a desktop sidebar (rating + mastery teaser) alongside the practice view at >=1024px, without any click', async () => {
    // Same mockMatchMedia shape as useMediaQuery.test.ts — reports a match
    // for every query, standing in for a >=1024px viewport.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        media: '(min-width: 1024px)',
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })),
    )

    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    const link = await screen.findByRole('link', { name: /view full stats/i })
    expect(link).toHaveAttribute('href', '/stats')
    expect(screen.getAllByText('1200').length).toBeGreaterThan(0)

    vi.unstubAllGlobals()
  })

  it('regression: the sidebar mastery teaser updates after an answer, no refresh (MasteryTeaser refetches on refreshKey change)', async () => {
    // Stateful storage stand-in: appendAttempt records into the same array
    // listAttempts reads back from, so a real refetch (and only a real
    // refetch) can observe the new attempt — this is what distinguishes a
    // regression in MasteryTeaser's `refreshKey` wiring (session.attemptVersion
    // never reaching it, or reaching it as a hardcoded constant) from
    // correct wiring. Both fixture patterns are seeded to exactly one
    // attempt short of MIN_ATTEMPTS_FOR_MASTERY (4), so whichever pattern
    // the next served puzzle happens to belong to (selectNext uses a real,
    // unmocked rng), answering it crosses that pattern's threshold and
    // flips its accuracy from null to a real percentage — a change that can
    // only appear in the DOM via a genuine refetch.
    function makeAttempt(puzzleId: string): Attempt {
      return {
        id: `${puzzleId}-${String(Math.random())}`,
        puzzleId,
        puzzleRating: 1200,
        mode: 'practice',
        correct: true,
        time_ms: 1000,
        choice_index: null,
        checkpoint_results: null,
        userRatingBefore: 1200,
        userRatingAfter: 1200,
        localDateString: '2026-07-17',
        createdAt: '2026-07-17T00:00:00.000Z',
      }
    }

    // p0 (off-by-one) and p1 (null-undefined) each get 4 attempts — one
    // short of the threshold for their respective pattern.
    const attemptsStore: Attempt[] = [
      makeAttempt('p0'),
      makeAttempt('p0'),
      makeAttempt('p0'),
      makeAttempt('p0'),
      makeAttempt('p1'),
      makeAttempt('p1'),
      makeAttempt('p1'),
      makeAttempt('p1'),
    ]
    vi.mocked(appendAttempt).mockImplementation((attempt) => {
      attemptsStore.push(attempt)
      return Promise.resolve()
    })
    vi.mocked(listAttempts).mockImplementation(() => Promise.resolve([...attemptsStore]))

    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        media: '(min-width: 1024px)',
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })),
    )

    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    // Before answering: every pattern is at or below 4 attempts, so no
    // pattern has a computable accuracy yet — the teaser shows its no-data
    // fallback, not a weakest-pattern line.
    await waitFor(() => {
      expect(
        screen.getByText(/solve a few puzzles to see your weakest pattern/i),
      ).toBeInTheDocument()
    })

    // Fixture puzzles all have `correct_choice: 0` ('a'), so this is always
    // a correct answer regardless of which puzzle got served.
    await user.click(nth(screen.getAllByRole('button', { name: 'a' }), 0))

    // After answering: whichever pattern was served just crossed the
    // threshold, so the teaser now shows a real weakest-pattern line.
    await waitFor(() => {
      expect(screen.getByText(/weakest:/i)).toBeInTheDocument()
    })
    expect(
      screen.queryByText(/solve a few puzzles to see your weakest pattern/i),
    ).not.toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  describe('desktop Browse (>=1024px)', () => {
    // Regression coverage for the Phase 0 bug: view === 'patterns' used to
    // return an early full-page takeover unconditionally, which on desktop
    // unmounted the sidebar AND the puzzle card — Browse had no "puzzle view
    // on the right" to reflect a selection into.
    function stubDesktop() {
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({
          matches: true,
          media: '(min-width: 1024px)',
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        })),
      )
    }

    it('desktop sidebar shows a weakest-pattern teaser (not the full mastery list) linking to /stats', async () => {
      stubDesktop()
      render(<PracticePage />)
      await waitFor(() => {
        expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
      })

      expect(screen.queryByText('Mastery by pattern')).not.toBeInTheDocument()
      const link = await screen.findByRole('link', { name: /view full stats/i })
      expect(link).toHaveAttribute('href', '/stats')

      vi.unstubAllGlobals()
    })

    it('clicking "Browse patterns" swaps the sidebar to the pattern picker without unmounting the puzzle in main', async () => {
      stubDesktop()
      const user = userEvent.setup()
      render(<PracticePage />)
      await waitFor(() => {
        expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
      })

      await user.click(screen.getByRole('link', { name: /browse patterns/i }))

      // The picker appears (in the sidebar) ...
      expect(screen.getByText('Practice by pattern')).toBeInTheDocument()
      // ... and the puzzle in main is still there, still interactive — not
      // unmounted by navigating into Browse, unlike the pre-fix full takeover.
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'a' }).length).toBeGreaterThan(0)

      vi.unstubAllGlobals()
    })

    it('selecting a pattern from the desktop picker immediately serves a puzzle from it and returns the sidebar to Mastery', async () => {
      stubDesktop()
      const user = userEvent.setup()
      render(<PracticePage />)
      await waitFor(() => {
        expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
      })

      await user.click(screen.getByRole('link', { name: /browse patterns/i }))
      expect(screen.getByText('Practice by pattern')).toBeInTheDocument()

      await user.click(screen.getByText(PATTERN_LABELS['null-undefined']))

      // No separate navigation step: the filter took effect and a puzzle
      // from it is already showing in main.
      await waitFor(() => {
        expect(
          screen.getByText(new RegExp(`filtering: ${PATTERN_LABELS['null-undefined']}`, 'i')),
        ).toBeInTheDocument()
      })
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
      // Sidebar is back to its normal Mastery content, not stuck on the picker.
      expect(screen.getByRole('link', { name: /view full stats/i })).toBeInTheDocument()
      expect(screen.queryByText('Practice by pattern')).not.toBeInTheDocument()

      vi.unstubAllGlobals()
    })

    it('the picker\'s own "Back" control returns the sidebar to Mastery without touching the current filter', async () => {
      stubDesktop()
      const user = userEvent.setup()
      render(<PracticePage />)
      await waitFor(() => {
        expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
      })

      await user.click(screen.getByRole('link', { name: /browse patterns/i }))
      expect(screen.getByText('Practice by pattern')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /back/i }))

      expect(screen.getByRole('link', { name: /view full stats/i })).toBeInTheDocument()
      expect(screen.queryByText(/filtering: /i)).not.toBeInTheDocument()

      vi.unstubAllGlobals()
    })
  })
})
