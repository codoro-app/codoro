/**
 * Export/import UI (v2 Phase 7, build-plan item 1) — a settings surface
 * over the existing, tested `exportData()`/`importData()` in
 * src/storage/exportImport.ts. This page is the UI only; the storage
 * functions themselves are untouched (see exportImport.ts's own doc
 * comment for the one addition made alongside them, and why it's additive
 * rather than a change to those functions).
 *
 * v4 Phase 4.1 ("Settings, for real"): gave this page real nav presence — a
 * gear icon in NavRail's rail footer (desktop) and AppShell's mobile top
 * bar — on top of the original footer link (still there, next to Legal).
 * Not one of the six main modes, so it still has no ModeSwitcher/BottomNav
 * tab of its own (BottomNav's 4 items are deliberately capped — see its own
 * doc comment); see AppShell.tsx/NavRail.tsx for where the gear lives at
 * each breakpoint. Also gained a real "Preferences" section this phase —
 * timer/reduced-motion/code-font-size/theme, all versioned through the same
 * `UserProfile.preferences` field export/import already carries (see
 * src/storage/schema.ts's PreferencesSchema doc comment) — the export/
 * import section below is unchanged, just re-homed further down the page.
 *
 * Challenge redesign: a "Challenge a friend" section holds the player's
 * `challengerName` (src/storage/schema.ts's own field, not part of
 * `preferences`) — a plain text field, not a first-use-only prompt. The
 * redesign's own name-prompt sheet (`ChallengerNameSheet.tsx`, shown by
 * `ChallengeButton` the first time a player creates a challenge) is a
 * one-time on-ramp, not the only place this can ever be set — this section
 * is where it's actually editable, same as every other `UserProfile` field
 * a player might want to revisit.
 *

 * The confirm-overwrite contract (locked by the Phase 7 build prompt's own
 * "decide precisely what that means" instruction): before writing anything,
 * show the player exactly what's about to be replaced — their current
 * rating, rated attempt count, and best run streak, side by side with what
 * the incoming file claims for the same three numbers. A dialog that just
 * says "this will overwrite your data" isn't what the DoD asks for.
 *
 * Four named bad-input states (same standard as /puzzle/:id's bad-id
 * branch and 5c's broken-link state), all driven by
 * `resolveImportCandidate`'s discriminated result: not JSON, JSON but not
 * shaped like an export, a newer schema version than this app understands,
 * and an older version — which isn't an error at all here, it's migrated
 * forward transparently (via the same migration chain `loadProfile` already
 * uses) and surfaces as a note on the confirm dialog rather than a failure.
 *
 * Validate-before-write: `resolveImportCandidate` never touches storage —
 * it only returns a result. The write happens once, atomically, in
 * `commitImport`, only after the player confirms. A rejected or cancelled
 * import never calls `commitImport` at all, so existing data is left
 * untouched by construction, not just by convention (asserted in
 * SettingsPage.test.tsx against real IndexedDB state).
 */
import { useEffect, useRef, useState } from 'react'
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_PREFERENCES,
  commitImport,
  exportData,
  loadProfile,
  resolveImportCandidate,
  saveProfile,
} from '../../storage'
import type { ExportedData, Preferences, UserProfile } from '../../storage'
import { FeedbackLink } from '../FeedbackLink'
import { applyPreferences } from '../preferences/applyPreferences'

// 2b.0: was `.settings-page` (settingsPage.css). Not test-asserted
// (grep-verified).
const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] mx-auto pt-[var(--space-4)] px-4 pb-6 text-text-1'
// Was `.settings-page__section h2`/`p`/`code` descendant selectors —
// applied directly to each element (same pattern as LegalPage.tsx).
const SECTION_HEADING_CLASS = 'text-lg text-text-0 m-0 mb-2'
const SECTION_COPY_CLASS = 'text-md leading-[1.5] m-0 mb-3'
const INLINE_CODE_CLASS = 'font-mono text-[0.9em] bg-surface-2 py-[0.1em] px-[0.35em] rounded-sm'
// Same pattern as LegalPage.tsx's own LINK_CLASS — an inline text link
// within a paragraph, not a standalone button.
const LINK_CLASS = 'text-accent'
const BUTTON_CLASS =
  'min-h-11 py-3 px-4 border border-border-strong rounded-md bg-surface-1 text-text-0 text-md font-semibold cursor-pointer'

// v4 Phase 4.1 (Settings, for real): preference-row layout, shared by every
// row in the new Preferences section below.
const PREF_ROW_CLASS =
  'flex items-start justify-between gap-4 py-3 px-3.5 border border-border rounded-md bg-surface-1 mb-2'
const PREF_LABEL_CLASS = 'text-md font-semibold text-text-0'
const PREF_DESC_CLASS = 'text-sm text-text-1 mt-0.5 max-w-[38ch]'

const CODE_FONT_SIZE_OPTIONS: { value: Preferences['codeFontSize']; label: string }[] = [
  { value: 'sm', label: 'S' },
  { value: 'md', label: 'M' },
  { value: 'lg', label: 'L' },
]

const THEME_OPTIONS: { value: Preferences['theme']; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'blue', label: 'Blue' },
  { value: 'slate', label: 'Slate' },
  { value: 'light', label: 'Light' },
]

type ImportFlowState =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'confirm'; data: ExportedData; migratedFromVersion: number | null }
  | { kind: 'importing'; data: ExportedData; migratedFromVersion: number | null }
  | { kind: 'success' }

function importErrorMessage(
  status: 'invalid-json' | 'not-export-blob' | 'unknown-version',
  foundVersion?: number,
): string {
  switch (status) {
    case 'invalid-json':
      return "This file isn't valid JSON — it can't be read as a Codoro export."
    case 'not-export-blob':
      return "This file doesn't look like a Codoro export, or is from a version too old for this app to read."
    case 'unknown-version':
      return `This export was made with a newer version of Codoro (format v${String(
        foundVersion,
      )}) than this app supports (v${String(CURRENT_SCHEMA_VERSION)}). Update the app, then try importing again.`
  }
}

export function SettingsPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileError, setProfileError] = useState(false)
  const [importFlow, setImportFlow] = useState<ImportFlowState>({ kind: 'idle' })
  const [exportError, setExportError] = useState(false)
  const [preferencesError, setPreferencesError] = useState(false)
  // Challenge redesign: `challengerNameDraft` is non-null only while the
  // player has typed something this session that hasn't been saved yet
  // (blur/Enter — see `saveChallengerName`) — the input's displayed value
  // falls back to the loaded profile's own value once there's no in-progress
  // edit, the same "draft overrides the source of truth until committed"
  // shape `useChallengerName.ts` uses for its own optimistic `name`.
  const [challengerNameDraft, setChallengerNameDraft] = useState<string | null>(null)
  const [challengerNameError, setChallengerNameError] = useState(false)
  const [challengerNameSaved, setChallengerNameSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // v4 Phase 4.1: the profile's own preferences, or DEFAULT_PREFERENCES
  // while `profile` is still loading — matches every existing default, so
  // the controls below never flash a wrong state once the real profile
  // arrives.
  const preferences = profile?.preferences ?? DEFAULT_PREFERENCES

  async function updatePreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferencesError(false)
    const base = profile ?? (await loadProfile())
    const nextProfile: UserProfile = { ...base, preferences: { ...base.preferences, [key]: value } }
    // Apply immediately, before the write resolves — instant same-tab
    // feedback (the whole point of a live theme/font-size/motion toggle),
    // same as AppShell's own on-load call to this function.
    applyPreferences(nextProfile.preferences)
    setProfile(nextProfile)
    try {
      await saveProfile(nextProfile)
    } catch {
      setPreferencesError(true)
    }
  }

  useEffect(() => {
    let cancelled = false
    loadProfile()
      .then((loaded) => {
        if (!cancelled) setProfile(loaded)
      })
      .catch(() => {
        if (!cancelled) setProfileError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Challenge redesign: mirrors `updatePreference`'s shape (load-if-missing,
  // apply optimistically, persist, surface a distinct error) but for the
  // single `challengerName` field rather than one of `preferences`' — a
  // blank field clears it back to `null` (challenges fall back to the
  // generic "A friend" copy), not an empty string.
  async function saveChallengerName(nextValue: string) {
    setChallengerNameError(false)
    setChallengerNameSaved(false)
    const trimmed = nextValue.trim()
    const base = profile ?? (await loadProfile())
    const nextChallengerName = trimmed.length > 0 ? trimmed : null
    if (nextChallengerName === base.challengerName) {
      setChallengerNameDraft(null)
      return
    }
    const nextProfile: UserProfile = { ...base, challengerName: nextChallengerName }
    setProfile(nextProfile)
    setChallengerNameDraft(null)
    try {
      await saveProfile(nextProfile)
      setChallengerNameSaved(true)
    } catch {
      setChallengerNameError(true)
    }
  }

  const challengerNameValue = challengerNameDraft ?? profile?.challengerName ?? ''

  async function handleExport() {
    setExportError(false)
    try {
      const json = await exportData()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const dateStamp = new Date().toISOString().slice(0, 10)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `codoro-export-${dateStamp}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch {
      setExportError(true)
    }
  }

  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset immediately so re-selecting the exact same file (e.g. after
    // fixing it) still fires a change event.
    event.target.value = ''
    if (!file) return

    void file
      .text()
      .then((text) => {
        const candidate = resolveImportCandidate(text)
        if (candidate.status === 'ok') {
          setImportFlow({
            kind: 'confirm',
            data: candidate.data,
            migratedFromVersion: candidate.migratedFromVersion,
          })
          return
        }
        setImportFlow({
          kind: 'error',
          message: importErrorMessage(
            candidate.status,
            candidate.status === 'unknown-version' ? candidate.foundVersion : undefined,
          ),
        })
      })
      .catch(() => {
        // A fifth, real bad-input case (pre-merge review finding):
        // File.text() can reject — NotReadableError — if the file was
        // moved/deleted/permission-revoked between the picker closing and
        // the read, routine on mobile and cloud-synced folders. Without
        // this, that case silently did nothing.
        setImportFlow({
          kind: 'error',
          message: "This file couldn't be read — try choosing it again.",
        })
      })
  }

  async function handleConfirmImport(data: ExportedData, migratedFromVersion: number | null) {
    setImportFlow({ kind: 'importing', data, migratedFromVersion })
    try {
      await commitImport(data)
      // Re-read from storage rather than trusting `data.profile` in memory
      // (pre-merge review finding): commitImport preserves this device's
      // own anonId rather than the imported file's (the import-collision
      // fix), so `data.profile.anonId` is stale/wrong the instant the
      // write commits — loadProfile() gets what was actually persisted.
      setProfile(await loadProfile())
      setImportFlow({ kind: 'success' })
    } catch {
      setImportFlow({
        kind: 'error',
        message: 'Something went wrong while saving — your existing data was not changed.',
      })
    }
  }

  const dialogState =
    importFlow.kind === 'confirm' || importFlow.kind === 'importing' ? importFlow : null

  return (
    <div className={PAGE_SHELL_CLASS}>
      <h1 className="text-2xl text-text-0 m-0">Settings</h1>

      <section>
        <h2 className={SECTION_HEADING_CLASS}>Preferences</h2>
        {preferencesError && (
          <p className="mt-0 mb-2 text-danger text-sm" role="alert">
            Something went wrong saving that — try again.
          </p>
        )}

        <div className={PREF_ROW_CLASS}>
          <div>
            <div className={PREF_LABEL_CLASS}>Timer on Trace</div>
            <div className={PREF_DESC_CLASS}>
              Show the countdown while stepping through a trace puzzle.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={preferences.timerOnTrace}
            aria-label="Timer on Trace"
            className={`relative flex-none w-10 h-[23px] rounded-full border-0 cursor-pointer ${
              preferences.timerOnTrace ? 'bg-accent' : 'bg-border-strong'
            }`}
            onClick={() => void updatePreference('timerOnTrace', !preferences.timerOnTrace)}
          >
            <span
              className={`absolute top-[2px] left-[2px] w-[19px] h-[19px] rounded-full transition-transform duration-150 ease-out ${
                preferences.timerOnTrace ? 'translate-x-[17px] bg-accent-ink' : 'bg-text-0'
              }`}
            />
          </button>
        </div>

        <div className={PREF_ROW_CLASS}>
          <div>
            <div className={PREF_LABEL_CLASS}>Reduce motion</div>
            <div className={PREF_DESC_CLASS}>
              Turn off transitions and animation, independent of your device&apos;s own setting.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={preferences.reducedMotion}
            aria-label="Reduce motion"
            className={`relative flex-none w-10 h-[23px] rounded-full border-0 cursor-pointer ${
              preferences.reducedMotion ? 'bg-accent' : 'bg-border-strong'
            }`}
            onClick={() => void updatePreference('reducedMotion', !preferences.reducedMotion)}
          >
            <span
              className={`absolute top-[2px] left-[2px] w-[19px] h-[19px] rounded-full transition-transform duration-150 ease-out ${
                preferences.reducedMotion ? 'translate-x-[17px] bg-accent-ink' : 'bg-text-0'
              }`}
            />
          </button>
        </div>

        <div className={PREF_ROW_CLASS}>
          <div>
            <div className={PREF_LABEL_CLASS}>Code font size</div>
            <div className={PREF_DESC_CLASS}>Applies to every puzzle&apos;s code snippet.</div>
          </div>
          <div
            className="flex flex-none border border-border rounded-md overflow-hidden"
            role="group"
            aria-label="Code font size"
          >
            {CODE_FONT_SIZE_OPTIONS.map((option, index) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={preferences.codeFontSize === option.value}
                className={`min-w-11 min-h-11 px-3 text-sm font-bold cursor-pointer border-0 ${
                  index > 0 ? 'border-l border-border' : ''
                } ${
                  preferences.codeFontSize === option.value
                    ? 'bg-accent text-accent-ink'
                    : 'bg-surface-1 text-text-1'
                }`}
                onClick={() => void updatePreference('codeFontSize', option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className={PREF_ROW_CLASS}>
          <div className="w-full">
            <div className={PREF_LABEL_CLASS}>Theme</div>
            <div className={PREF_DESC_CLASS}>
              Pick the accent and surface palette used across the app.
            </div>
            <div className="flex flex-wrap gap-2 mt-3" role="group" aria-label="Theme">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={preferences.theme === option.value}
                  className={`min-h-11 px-3.5 rounded-md text-sm font-bold cursor-pointer border ${
                    preferences.theme === option.value
                      ? 'border-accent bg-surface-2 text-text-0'
                      : 'border-border bg-surface-1 text-text-1'
                  }`}
                  onClick={() => void updatePreference('theme', option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className={SECTION_HEADING_CLASS}>Challenge a friend</h2>
        <p className={SECTION_COPY_CLASS}>
          Your display name on outgoing challenge links — e.g. &ldquo;
          {challengerNameValue.trim() || 'Alex'} challenged you!&rdquo; Leave it blank to challenge
          as &ldquo;A friend&rdquo;.
        </p>
        {challengerNameError && (
          <p className="mt-0 mb-2 text-danger text-sm" role="alert">
            Something went wrong saving that — try again.
          </p>
        )}
        <div className={PREF_ROW_CLASS}>
          <div className="w-full">
            <label htmlFor="challenger-name-setting" className={PREF_LABEL_CLASS}>
              Your name
            </label>
            <input
              id="challenger-name-setting"
              type="text"
              value={challengerNameValue}
              maxLength={40}
              placeholder="Not set"
              className="mt-2 w-full min-h-11 py-2 px-3 rounded-sm border border-border bg-surface-0 text-text-0"
              onChange={(event) => {
                setChallengerNameDraft(event.target.value)
                setChallengerNameSaved(false)
              }}
              onBlur={(event) => void saveChallengerName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
            {challengerNameSaved && (
              <p className="mt-1 text-accent text-sm" role="status">
                Saved
              </p>
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className={SECTION_HEADING_CLASS}>Your data</h2>
        <p className={SECTION_COPY_CLASS}>
          Codoro has no accounts — your rating, streak, and puzzle history live only in this
          browser. Export a copy to back it up or move it to another device; import a copy to
          restore it.
        </p>
        {profileError && (
          <p className="mt-2 text-danger text-sm" role="alert">
            Couldn&apos;t load your current data. Export and import may not reflect it correctly —
            try reloading the page.
          </p>
        )}
      </section>

      <section>
        <h2 className={SECTION_HEADING_CLASS}>Export</h2>
        <p className={SECTION_COPY_CLASS}>Download your data as a file.</p>
        <button type="button" className={BUTTON_CLASS} onClick={() => void handleExport()}>
          Export my data
        </button>
        {exportError && (
          <p className="mt-2 text-danger text-sm" role="alert">
            Export failed — nothing was downloaded. Try again.
          </p>
        )}
      </section>

      <section>
        <h2 className={SECTION_HEADING_CLASS}>Import</h2>
        <p className={SECTION_COPY_CLASS}>
          Replace your current data with a previously exported file. You&apos;ll see exactly
          what&apos;s about to change before anything is replaced.
        </p>
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => fileInputRef.current?.click()}
        >
          Choose file to import…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={handleFileSelected}
          aria-label="Choose a Codoro export file to import"
        />
        {importFlow.kind === 'error' && (
          <p className="mt-2 text-danger text-sm" role="alert">
            {importFlow.message}
          </p>
        )}
        {importFlow.kind === 'success' && (
          <p className="mt-2 text-accent text-sm" role="status">
            Import complete — your data has been replaced.
          </p>
        )}
      </section>

      <section>
        <h2 className={SECTION_HEADING_CLASS}>Reset your rating</h2>
        <p className={SECTION_COPY_CLASS}>
          There&apos;s no in-app rating reset button, but the export/import above doubles as one:
          export your data, open the downloaded file in a text editor, change the number after{' '}
          <code className={INLINE_CODE_CLASS}>&quot;rating&quot;</code> under{' '}
          <code className={INLINE_CODE_CLASS}>&quot;profile&quot;</code>, save, then import that
          file back in here.
        </p>
      </section>

      <section>
        <h2 className={SECTION_HEADING_CLASS}>Feedback</h2>
        <p className={SECTION_COPY_CLASS}>
          Found a bug or have an idea for Codoro?{' '}
          <FeedbackLink surface="settings" className={LINK_CLASS} /> opens a short external form in
          a new tab.
        </p>
      </section>

      <section>
        <h2 className={SECTION_HEADING_CLASS}>Keyboard shortcuts</h2>
        <p className={SECTION_COPY_CLASS}>On desktop, every puzzle is playable without a mouse.</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-md text-text-0">
          <dt>
            <code className={INLINE_CODE_CLASS}>Tab</code> /{' '}
            <code className={INLINE_CODE_CLASS}>Shift+Tab</code>
          </dt>
          <dd className="m-0">Move between choices, buttons, and other controls</dd>
          <dt>
            <code className={INLINE_CODE_CLASS}>↑</code> /{' '}
            <code className={INLINE_CODE_CLASS}>↓</code>
          </dt>
          <dd className="m-0">
            Move focus between choices without leaving the list (multiple choice, tap-the-line,
            drag-order)
          </dd>
          <dt>
            <code className={INLINE_CODE_CLASS}>Enter</code>
          </dt>
          <dd className="m-0">Submit the focused choice — focus then jumps to Next puzzle</dd>
          <dt>
            <code className={INLINE_CODE_CLASS}>Enter</code> again
          </dt>
          <dd className="m-0">Advance once Next puzzle has focus</dd>
          <dt>
            <code className={INLINE_CODE_CLASS}>←</code> /{' '}
            <code className={INLINE_CODE_CLASS}>→</code>
          </dt>
          <dd className="m-0">On a swipe puzzle: your answer (left or right)</dd>
          <dt>
            <code className={INLINE_CODE_CLASS}>←</code> /{' '}
            <code className={INLINE_CODE_CLASS}>→</code>
          </dt>
          <dd className="m-0">On a trace: step backward or forward one line</dd>
        </dl>
      </section>

      {dialogState && (
        <ImportConfirmDialog
          current={profile}
          incoming={dialogState.data}
          migratedFromVersion={dialogState.migratedFromVersion}
          busy={dialogState.kind === 'importing'}
          onCancel={() => {
            setImportFlow({ kind: 'idle' })
          }}
          onConfirm={() => {
            void handleConfirmImport(dialogState.data, dialogState.migratedFromVersion)
          }}
        />
      )}
    </div>
  )
}

interface ImportConfirmDialogProps {
  current: UserProfile | null
  incoming: ExportedData
  migratedFromVersion: number | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

function ImportConfirmDialog({
  current,
  incoming,
  migratedFromVersion,
  busy,
  onCancel,
  onConfirm,
}: ImportConfirmDialogProps) {
  // 2b.0: was `.settings-page__confirm-table th`/`td` (right-aligned,
  // bordered) with `th[scope='row']` overriding to left-aligned/muted/
  // normal-weight — applied directly per cell since there's no attribute
  // selector equivalent in Tailwind utility classes.
  const cellClass = 'py-2 text-right border-b border-border'
  const rowHeaderClass = 'py-2 text-left border-b border-border text-text-1 font-normal'

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center p-4 bg-surface-0/70">
      <div
        className="flex flex-col gap-3 w-full max-w-[420px] py-6 px-5 rounded-lg border border-border bg-surface-1"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm import — replace your data"
      >
        <p className="m-0 text-xl font-bold text-text-0">Replace your data?</p>
        <p className="m-0 text-sm text-text-1">
          Importing this file replaces your current rating, streak, and attempt history. This
          can&apos;t be undone unless you&apos;ve exported your current data separately.
        </p>
        {migratedFromVersion !== null && (
          <p className="m-0 text-sm text-accent">
            This file is from an older Codoro version and will be upgraded automatically.
          </p>
        )}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={cellClass}></th>
              <th scope="col" className={cellClass}>
                Current
              </th>
              <th scope="col" className={cellClass}>
                Incoming
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className={rowHeaderClass}>
                Rating
              </th>
              <td className={cellClass}>{current ? Math.round(current.rating) : '—'}</td>
              <td className={cellClass}>{Math.round(incoming.profile.rating)}</td>
            </tr>
            <tr>
              <th scope="row" className={rowHeaderClass}>
                Rated attempts
              </th>
              <td className={cellClass}>{current ? current.ratedAttemptCount : '—'}</td>
              <td className={cellClass}>{incoming.profile.ratedAttemptCount}</td>
            </tr>
            <tr>
              <th scope="row" className={rowHeaderClass}>
                Best streak
              </th>
              <td className={cellClass}>{current ? current.bestRunStreak : '—'}</td>
              <td className={cellClass}>{incoming.profile.bestRunStreak}</td>
            </tr>
          </tbody>
        </table>
        <div className="flex flex-col gap-2 mt-2">
          <button
            type="button"
            className="min-h-11 w-full py-3 px-4 rounded-md text-md font-semibold border border-border-strong bg-transparent text-text-0"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="min-h-11 w-full py-3 px-4 rounded-md text-md font-semibold border-0 bg-accent text-accent-ink"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Replacing…' : 'Replace my data'}
          </button>
        </div>
      </div>
    </div>
  )
}
