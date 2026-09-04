import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DB_NAME } from '../../storage/db'
import {
  CURRENT_SCHEMA_VERSION,
  appendAttempt,
  createDefaultProfile,
  exportData,
  importData,
  listAttempts,
  loadProfile,
  saveProfile,
} from '../../storage'
import type { Attempt, UserProfile } from '../../storage'
import { FEEDBACK_URL } from '../FeedbackLink'
import { SettingsPage } from './SettingsPage'

const trackFeedbackLinkClicked = vi.fn()

vi.mock('../../telemetry', () => ({
  trackFeedbackLinkClicked: (...args: unknown[]) => {
    trackFeedbackLinkClicked(...args)
  },
}))

afterEach(async () => {
  vi.restoreAllMocks()
  trackFeedbackLinkClicked.mockClear()
  await deleteDB(DB_NAME)
})

function exportBlob(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema_version: CURRENT_SCHEMA_VERSION,
    exportedAt: '2026-08-09T00:00:00.000Z',
    profile: { ...createDefaultProfile(), rating: 1999, ratedAttemptCount: 42, bestRunStreak: 9 },
    attempts: [],
    ...overrides,
  })
}

async function uploadFile(text: string) {
  const input = screen.getByLabelText('Choose a Codoro export file to import', {
    selector: 'input',
  })
  const file = new File([text], 'export.json', { type: 'application/json' })
  await userEvent.upload(input, file)
}

const distinctiveAttempt: Attempt = {
  id: 'seeded-attempt-1',
  puzzleId: 'seeded-puzzle',
  puzzleRating: 1400,
  mode: 'practice',
  correct: true,
  time_ms: 1000,
  choice_index: 0,
  checkpoint_results: null,
  userRatingBefore: 1000,
  userRatingAfter: 1010,
  localDateString: '2026-08-09',
  createdAt: '2026-08-09T00:00:00.000Z',
}

/** Seeds a distinctive profile + attempt, so a later read can prove neither changed. */
async function seedDistinctiveData(): Promise<UserProfile> {
  const profile = { ...createDefaultProfile(), rating: 1234, ratedAttemptCount: 7 }
  await saveProfile(profile)
  await appendAttempt(distinctiveAttempt)
  return profile
}

async function expectDataUntouched(seededProfile: UserProfile) {
  expect(await loadProfile()).toEqual(seededProfile)
  expect(await listAttempts()).toEqual([distinctiveAttempt])
}

describe('SettingsPage', () => {
  it('shows the current rating once the profile loads', async () => {
    await saveProfile({ ...createDefaultProfile(), rating: 1500 })
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument()
    })
  })

  it('export button triggers a download of exportData()s output', async () => {
    await saveProfile({ ...createDefaultProfile(), rating: 1234 })
    const createObjectURL = vi.fn(() => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    render(<SettingsPage />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Export my data' }))

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1)
    })
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('shows a legible error for a file that is not valid JSON, and leaves existing data untouched', async () => {
    const seeded = await seedDistinctiveData()
    render(<SettingsPage />)
    await uploadFile('{not valid json')

    expect(
      await screen.findByText(/isn't valid JSON — it can't be read as a Codoro export/),
    ).toBeInTheDocument()
    await expectDataUntouched(seeded)
  })

  it('shows a legible error for JSON that is not shaped like an export, and leaves existing data untouched', async () => {
    const seeded = await seedDistinctiveData()
    render(<SettingsPage />)
    await uploadFile(JSON.stringify({ hello: 'world' }))

    expect(await screen.findByText(/doesn't look like a Codoro export/)).toBeInTheDocument()
    await expectDataUntouched(seeded)
  })

  it('shows a legible error for a newer schema version than this app supports, and leaves existing data untouched', async () => {
    const seeded = await seedDistinctiveData()
    render(<SettingsPage />)
    await uploadFile(
      exportBlob({
        schema_version: CURRENT_SCHEMA_VERSION + 1,
        profile: { ...createDefaultProfile(), schema_version: CURRENT_SCHEMA_VERSION + 1 },
      }),
    )

    expect(await screen.findByText(/made with a newer version of Codoro/)).toBeInTheDocument()
    await expectDataUntouched(seeded)
  })

  it('shows the confirm-overwrite dialog with current vs incoming numbers for a valid export', async () => {
    await saveProfile({
      ...createDefaultProfile(),
      rating: 1000,
      ratedAttemptCount: 5,
      bestRunStreak: 2,
    })
    render(<SettingsPage />)
    await waitFor(() => screen.getByText('Settings'))

    await uploadFile(exportBlob())

    expect(await screen.findByText('Replace your data?')).toBeInTheDocument()
    // Current column
    expect(screen.getByText('1000')).toBeInTheDocument()
    // Incoming column
    expect(screen.getByText('1999')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
  })

  it('cancelling the confirm dialog does not write anything, verified against real storage', async () => {
    const seeded = await seedDistinctiveData()
    render(<SettingsPage />)
    await uploadFile(exportBlob())
    await screen.findByText('Replace your data?')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('Replace your data?')).not.toBeInTheDocument()
    expect(screen.queryByText(/Import complete/)).not.toBeInTheDocument()
    await expectDataUntouched(seeded)
  })

  it('confirming the import actually replaces the stored profile and attempts, not just the on-screen text', async () => {
    await saveProfile({ ...createDefaultProfile(), rating: 1000 })
    render(<SettingsPage />)
    const incomingAttempt: Attempt = { ...distinctiveAttempt, id: 'incoming-attempt-1' }
    await uploadFile(exportBlob({ attempts: [incomingAttempt] }))
    await screen.findByText('Replace your data?')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Replace my data' }))

    expect(await screen.findByText(/Import complete/)).toBeInTheDocument()
    const stored = await loadProfile()
    expect(stored.rating).toBe(1999)
    expect(stored.ratedAttemptCount).toBe(42)
    expect(stored.bestRunStreak).toBe(9)
    expect(await listAttempts()).toEqual([incomingAttempt])
  })

  it('lists keyboard shortcuts (v4 Phase 4.0, todo 24; copy clarified per PR #88 review)', () => {
    render(<SettingsPage />)
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    expect(screen.getByText('Tab')).toBeInTheDocument()
    // "Enter" now appears twice — once for the commit step, once for the
    // separate advance step (the two-Enter-presses distinction this test's
    // predecessor didn't cover, per the live-review finding that the old
    // single "commit, then advance" line read as one press doing both).
    expect(screen.getAllByText('Enter').length).toBe(2)
    expect(screen.getByText(/submit the focused choice/i)).toBeInTheDocument()
    expect(screen.getByText(/advance once next puzzle has focus/i)).toBeInTheDocument()
  })

  describe('Preferences (v4 Phase 4.1)', () => {
    it('toggling Timer on Trace flips aria-checked and persists to storage', async () => {
      await saveProfile(createDefaultProfile())
      render(<SettingsPage />)
      await waitFor(() => screen.getByText('Settings'))

      const toggle = screen.getByRole('switch', { name: 'Timer on Trace' })
      expect(toggle).toHaveAttribute('aria-checked', 'false')

      const user = userEvent.setup()
      await user.click(toggle)

      await waitFor(() => {
        expect(toggle).toHaveAttribute('aria-checked', 'true')
      })
      expect((await loadProfile()).preferences.timerOnTrace).toBe(true)
    })

    it('toggling Sound flips aria-checked and persists to storage', async () => {
      await saveProfile(createDefaultProfile())
      render(<SettingsPage />)
      await waitFor(() => screen.getByText('Settings'))

      const toggle = screen.getByRole('switch', { name: 'Sound' })
      expect(toggle).toHaveAttribute('aria-checked', 'true')

      const user = userEvent.setup()
      await user.click(toggle)

      await waitFor(() => {
        expect(toggle).toHaveAttribute('aria-checked', 'false')
      })
      expect((await loadProfile()).preferences.sound).toBe(false)
    })

    it('toggling Auto-advance flips aria-checked and persists to storage', async () => {
      await saveProfile(createDefaultProfile())
      render(<SettingsPage />)
      await waitFor(() => screen.getByText('Settings'))

      const toggle = screen.getByRole('switch', { name: 'Auto-advance' })
      expect(toggle).toHaveAttribute('aria-checked', 'true')

      const user = userEvent.setup()
      await user.click(toggle)

      await waitFor(() => {
        expect(toggle).toHaveAttribute('aria-checked', 'false')
      })
      expect((await loadProfile()).preferences.autoAdvance).toBe(false)
    })

    it('picking a code font size updates aria-pressed and persists to storage', async () => {
      await saveProfile(createDefaultProfile())
      render(<SettingsPage />)
      await waitFor(() => screen.getByText('Settings'))

      const user = userEvent.setup()
      const largeOption = screen.getByRole('button', { name: 'L' })
      await user.click(largeOption)

      await waitFor(() => {
        expect(largeOption).toHaveAttribute('aria-pressed', 'true')
      })
      expect((await loadProfile()).preferences.codeFontSize).toBe('lg')
    })

    it('picking a theme updates aria-pressed, sets data-app-theme on the document root, and persists to storage', async () => {
      await saveProfile(createDefaultProfile())
      render(<SettingsPage />)
      await waitFor(() => screen.getByText('Settings'))

      const user = userEvent.setup()
      const blueOption = screen.getByRole('button', { name: 'Blue' })
      await user.click(blueOption)

      await waitFor(() => {
        expect(blueOption).toHaveAttribute('aria-pressed', 'true')
      })
      expect(document.documentElement.dataset.appTheme).toBe('blue')
      expect((await loadProfile()).preferences.theme).toBe('blue')
    })

    it('every preference round-trips through export -> import unchanged', async () => {
      const seeded = {
        ...createDefaultProfile(),
        preferences: {
          timerOnTrace: true,
          reducedMotion: true,
          codeFontSize: 'lg' as const,
          theme: 'slate' as const,
          sound: true,
          autoAdvance: true,
        },
      }
      await saveProfile(seeded)

      const json = await exportData()
      await deleteDB(DB_NAME)
      await importData(json)

      expect((await loadProfile()).preferences).toEqual(seeded.preferences)
    })
  })

  describe('Challenge a friend (challenge redesign) — challengerName is editable here, not set-once', () => {
    it('shows an empty field for a profile that has never set a name', async () => {
      await saveProfile(createDefaultProfile())
      render(<SettingsPage />)
      await waitFor(() => screen.getByText('Settings'))

      expect(screen.getByLabelText('Your name')).toHaveValue('')
    })

    it('pre-fills the field with an already-saved name', async () => {
      await saveProfile({ ...createDefaultProfile(), challengerName: 'Alex' })
      render(<SettingsPage />)
      await waitFor(() => screen.getByText('Settings'))

      expect(await screen.findByDisplayValue('Alex')).toBeInTheDocument()
    })

    it('typing a new name and blurring persists it, replacing an old saved value', async () => {
      await saveProfile({ ...createDefaultProfile(), challengerName: 'Alex' })
      render(<SettingsPage />)
      await waitFor(() => screen.getByText('Settings'))

      const user = userEvent.setup()
      const input = await screen.findByDisplayValue('Alex')
      await user.clear(input)
      await user.type(input, 'Sam')
      await user.tab()

      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent('Saved')
      })
      expect((await loadProfile()).challengerName).toBe('Sam')
    })

    it('clearing the field back to blank saves it as null, not an empty string', async () => {
      await saveProfile({ ...createDefaultProfile(), challengerName: 'Alex' })
      render(<SettingsPage />)
      await waitFor(() => screen.getByText('Settings'))

      const user = userEvent.setup()
      const input = await screen.findByDisplayValue('Alex')
      await user.clear(input)
      await user.tab()

      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent('Saved')
      })
      expect((await loadProfile()).challengerName).toBeNull()
    })

    it('Enter commits the same as blur', async () => {
      await saveProfile(createDefaultProfile())
      render(<SettingsPage />)
      await waitFor(() => screen.getByText('Settings'))

      const user = userEvent.setup()
      const input = screen.getByLabelText('Your name')
      await user.type(input, 'Sam{Enter}')

      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent('Saved')
      })
      expect((await loadProfile()).challengerName).toBe('Sam')
    })
  })

  // Launch instrumentation Item 2: SettingsPage's own Feedback section,
  // its own <h2> (no second <h1> — SettingsPage already has one).
  describe('Feedback section', () => {
    it('has its own section heading, not a second <h1>', () => {
      render(<SettingsPage />)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings')
      expect(screen.getByRole('heading', { level: 2, name: 'Feedback' })).toBeInTheDocument()
    })

    it('links to the external Tally form, opened in a new tab', () => {
      render(<SettingsPage />)
      const feedbackLink = screen.getByRole('link', { name: 'Feedback' })
      expect(feedbackLink).toHaveAttribute('href', FEEDBACK_URL)
      expect(feedbackLink).toHaveAttribute('target', '_blank')
      expect(feedbackLink).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('fires feedback_link_clicked with surface: "settings" when clicked', async () => {
      const user = userEvent.setup()
      render(<SettingsPage />)
      await user.click(screen.getByRole('link', { name: 'Feedback' }))
      expect(trackFeedbackLinkClicked).toHaveBeenCalledWith({ surface: 'settings' })
    })
  })
})
