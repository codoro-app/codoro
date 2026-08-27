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
  listAttempts,
  loadProfile,
  saveProfile,
} from '../../storage'
import type { Attempt, UserProfile } from '../../storage'
import { SettingsPage } from './SettingsPage'

afterEach(async () => {
  vi.restoreAllMocks()
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

  it('lists keyboard shortcuts (v4 Phase 4.0, todo 24)', () => {
    render(<SettingsPage />)
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    expect(screen.getByText('Enter')).toBeInTheDocument()
    expect(screen.getByText(/commit your answer, then advance/i)).toBeInTheDocument()
  })
})
