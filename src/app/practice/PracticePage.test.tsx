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

const { FIXTURE_POOL } = vi.hoisted(() => ({
  FIXTURE_POOL: Array.from({ length: 12 }, (_, i) => ({
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
  })),
}))

vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return { ...actual, puzzlePool: FIXTURE_POOL, quizPool: FIXTURE_POOL }
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
  trackAttempt: vi.fn(),
  trackShareClick: vi.fn(),
  trackChallengeCreate: vi.fn(),
  trackError: vi.fn(),
}))

const { loadProfile, saveProfile, appendAttempt, listAttempts, createDefaultProfile } =
  await import('../../storage')
const { trackShareClick, trackChallengeCreate } = await import('../../telemetry')
const { PracticePage } = await import('./PracticePage')

describe('PracticePage', () => {
  beforeEach(() => {
    vi.mocked(loadProfile).mockResolvedValue(createDefaultProfile())
    vi.mocked(saveProfile).mockResolvedValue(undefined)
    vi.mocked(appendAttempt).mockResolvedValue(undefined)
    vi.mocked(listAttempts).mockResolvedValue([])
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

    expect(screen.getByText(/loading/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })
    // Rating pill shows the default starting rating.
    expect(screen.getByText('1200')).toBeInTheDocument()
  })

  it('reveals a share card after answering, firing share_click on copy, then hides it once Continue serves a new puzzle', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    expect(screen.queryByText(/Copy share text/i)).not.toBeInTheDocument()

    await user.click(nth(screen.getAllByRole('button', { name: 'a' }), 0))
    await waitFor(() => {
      expect(screen.getByText(/Copy share text/i)).toBeInTheDocument()
    })

    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    await user.click(screen.getByText(/Copy share text/i))
    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('Codoro Practice —'))
    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('getcodoro.com/puzzle/'))
    expect(trackShareClick).toHaveBeenCalledTimes(1)
    expect(trackShareClick).toHaveBeenCalledWith(expect.objectContaining({ surface: 'practice' }))

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(screen.queryByText(/Copy share text/i)).not.toBeInTheDocument()
    })
  })

  it('shows the challenge card after a correct answer, with a working copy button that re-encodes the streak', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: 'Challenge a friend' })).not.toBeInTheDocument()

    await user.click(nth(screen.getAllByRole('button', { name: 'a' }), 0))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Challenge a friend' })).toBeInTheDocument()
    })

    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    // This file's beforeEach has no vi.clearAllMocks(), so a spy placed in
    // an earlier test (the share-card test's "Copy share text" click) may
    // still be the same accumulated spy — clear it so calls[0] is this
    // test's own write, not a leftover.
    writeTextSpy.mockClear()
    await user.click(screen.getByRole('button', { name: 'Challenge a friend' }))

    expect(trackChallengeCreate).toHaveBeenCalledTimes(1)
    expect(trackChallengeCreate).toHaveBeenCalledWith({ surface: 'practice', puzzle_count: 1 })

    const url = writeTextSpy.mock.calls[0]?.[0]
    if (typeof url !== 'string')
      throw new Error('expected writeText to have been called with a URL')
    expect(url).toMatch(/^Beat my Codoro Practice streak — 1 in a row — getcodoro\.com\/challenge#/)

    const decoded = decodeChallengePayload(url.split('#')[1] ?? '')
    expect(decoded).not.toBeNull()
    expect(decoded?.ids).toHaveLength(1)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Link copied!' })).toBeInTheDocument()
    })
  })

  it('clears the challenge card on Continue — it must not persist under the next, unanswered puzzle', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    await user.click(nth(screen.getAllByRole('button', { name: 'a' }), 0))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Challenge a friend' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /Challenge a friend|Link copied!/ }),
      ).not.toBeInTheDocument()
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
    expect(screen.getByText(/loading your practice session/i)).toBeInTheDocument()

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
    await user.click(screen.getByRole('button', { name: 'Continue' }))
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

  it('while filtered, selecting a different mastery row switches the filter rather than stacking', async () => {
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

    await user.click(screen.getByRole('button', { name: /^mastery$/i }))
    await waitFor(() => {
      expect(screen.getByText(/mastery by pattern/i)).toBeInTheDocument()
    })
    const otherRow = screen.getByText(PATTERN_LABELS['off-by-one']).closest('button')
    expect(otherRow).not.toBeNull()
    await user.click(otherRow as HTMLElement)

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

  it('mastery view is reachable and has a way back to practice', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /^mastery$/i }))
    await waitFor(() => {
      expect(screen.getByText(/mastery by pattern/i)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })
  })

  it('answering and continuing serves a fresh, unanswered card', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    await user.click(nth(screen.getAllByRole('button', { name: 'a' }), 0))
    expect(screen.getByRole('status')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    // AnimatePresence keeps the outgoing (answered) card mounted until its
    // exit transition finishes — real wall-clock time, not a synchronous
    // state flush — so wait for it to actually leave the DOM.
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  it('scrolls to the top when a new puzzle is served (Continue and pattern-filter switch)', async () => {
    const user = userEvent.setup()
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })
    // The initial serve on mount also counts as "a puzzle was served". The
    // scroll-reset effect is a separate (passive) effect from the one that
    // renders the prompt text, so it can flush a tick later — wait for the
    // spy directly rather than assuming it landed by the time the text did.
    await waitFor(() => {
      expect(scrollToSpy).toHaveBeenCalledWith({ top: 0 })
    })
    scrollToSpy.mockClear()

    await user.click(nth(screen.getAllByRole('button', { name: 'a' }), 0))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(scrollToSpy).toHaveBeenCalledWith({ top: 0 })
    })
    scrollToSpy.mockClear()

    await user.click(screen.getByRole('link', { name: /browse patterns/i }))
    await user.click(screen.getByText(PATTERN_LABELS['null-undefined']))
    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`filtering: ${PATTERN_LABELS['null-undefined']}`, 'i')),
      ).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(scrollToSpy).toHaveBeenCalledWith({ top: 0 })
    })

    scrollToSpy.mockRestore()
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

  it('regression: mastery panel and session counter update immediately after an answer, no refresh (desktop sidebar)', async () => {
    // Stateful storage stand-in: appendAttempt records into the same array
    // listAttempts reads back from, so a real refetch (and only a real
    // refetch) can observe the new attempt — this is what distinguishes the
    // bug (MasteryView fetches once on mount and never again) from a fix.
    const attemptsStore: Attempt[] = []
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

    // Sums every mastery row's "N attempts" count — pattern-agnostic since
    // selectNext serves from a real (unmocked) rng, so which pattern the
    // served puzzle belongs to isn't fixed across runs.
    const totalMasteryAttempts = () =>
      Array.from(document.querySelectorAll('.mastery-row__count')).reduce((sum, el) => {
        const match = /\d+/.exec(el.textContent)
        return sum + (match ? Number(match[0]) : 0)
      }, 0)

    // Before answering: sidebar shows 0 solved and no attempts recorded yet.
    expect(screen.getAllByText(/0 solved this session/i).length).toBeGreaterThan(0)
    await waitFor(() => {
      expect(screen.queryByText(/loading mastery/i)).not.toBeInTheDocument()
    })
    expect(totalMasteryAttempts()).toBe(0)

    await user.click(nth(screen.getAllByRole('button', { name: 'a' }), 0))

    await waitFor(() => {
      expect(screen.getAllByText(/1 solved this session/i).length).toBeGreaterThan(0)
    })
    await waitFor(() => {
      expect(totalMasteryAttempts()).toBe(1)
    })

    vi.unstubAllGlobals()
  })

  it('clicking a mastery row starts practicing that pattern (mobile "Mastery" view)', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /^mastery$/i }))
    await waitFor(() => {
      expect(screen.getByText(/mastery by pattern/i)).toBeInTheDocument()
    })

    const row = screen.getByText(PATTERN_LABELS['null-undefined']).closest('button')
    expect(row).not.toBeNull()
    await user.click(row as HTMLElement)

    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`filtering: ${PATTERN_LABELS['null-undefined']}`, 'i')),
      ).toBeInTheDocument()
    })
    // Back on the practice view, not stuck on the mastery view.
    expect(screen.queryByText(/mastery by pattern/i)).not.toBeInTheDocument()
  })

  it('an interactive mastery row is a real <button> (keyboard-focusable, carries the tap-target-min sizing class)', async () => {
    const user = userEvent.setup()
    render(<PracticePage />)
    await waitFor(() => {
      expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /^mastery$/i }))
    await waitFor(() => {
      expect(screen.getByText(/mastery by pattern/i)).toBeInTheDocument()
    })

    const row = screen.getByText(PATTERN_LABELS['off-by-one']).closest('button')
    expect(row).not.toBeNull()
    expect(row?.tagName).toBe('BUTTON')
    expect(row).toHaveClass('mastery-row')
    row?.focus()
    expect(row).toHaveFocus()
  })

  it('shows a desktop sidebar (rating + mastery) alongside the practice view at >=1024px, without any click', async () => {
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

    expect(screen.getByText('Mastery by pattern')).toBeInTheDocument()
    expect(screen.getAllByText('1200').length).toBeGreaterThan(0)

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
      expect(screen.getByText('Mastery by pattern')).toBeInTheDocument()
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

      expect(screen.getByText('Mastery by pattern')).toBeInTheDocument()
      expect(screen.queryByText(/filtering: /i)).not.toBeInTheDocument()

      vi.unstubAllGlobals()
    })
  })
})
