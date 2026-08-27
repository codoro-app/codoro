/**
 * Export/import UI (v2 Phase 7, build-plan item 1) — a settings surface
 * over the existing, tested `exportData()`/`importData()` in
 * src/storage/exportImport.ts. This page is the UI only; the storage
 * functions themselves are untouched (see exportImport.ts's own doc
 * comment for the one addition made alongside them, and why it's additive
 * rather than a change to those functions).
 *
 * Reachable only via the app-shell footer link, next to Legal — not one of
 * the four main modes, so it has no ModeSwitcher/NavRail tab (same
 * precedent as LegalPage.tsx).
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
  commitImport,
  exportData,
  loadProfile,
  resolveImportCandidate,
} from '../../storage'
import type { ExportedData, UserProfile } from '../../storage'

// 2b.0: was `.settings-page` (settingsPage.css). Not test-asserted
// (grep-verified).
const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] mx-auto pt-[var(--space-4)] px-4 pb-6 text-text-1'
// Was `.settings-page__section h2`/`p`/`code` descendant selectors —
// applied directly to each element (same pattern as LegalPage.tsx).
const SECTION_HEADING_CLASS = 'text-lg text-text-0 m-0 mb-2'
const SECTION_COPY_CLASS = 'text-md leading-[1.5] m-0 mb-3'
const INLINE_CODE_CLASS = 'font-mono text-[0.9em] bg-surface-2 py-[0.1em] px-[0.35em] rounded-sm'
const BUTTON_CLASS =
  'min-h-11 py-3 px-4 border border-border-strong rounded-md bg-surface-1 text-text-0 text-md font-semibold cursor-pointer'

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
  const fileInputRef = useRef<HTMLInputElement>(null)

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
        <h2 className={SECTION_HEADING_CLASS}>Keyboard shortcuts</h2>
        <p className={SECTION_COPY_CLASS}>On desktop, every puzzle is playable without a mouse.</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-md text-text-0">
          <dt>
            <code className={INLINE_CODE_CLASS}>Enter</code>
          </dt>
          <dd className="m-0">Commit your answer, then advance to the next puzzle</dd>
          <dt>
            <code className={INLINE_CODE_CLASS}>↑ / ↓</code>
          </dt>
          <dd className="m-0">Move between choices (multiple choice, tap-the-line, drag-order)</dd>
          <dt>
            <code className={INLINE_CODE_CLASS}>← / →</code>
          </dt>
          <dd className="m-0">Answer a swipe puzzle, or step through a trace</dd>
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
