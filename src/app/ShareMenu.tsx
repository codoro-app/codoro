/**
 * Consolidated share/challenge affordance (v3 Phase 2b.4; icon-copy split
 * added same phase per design-review follow-up; 2b.11 replaced the
 * inline-single-action/anchored-popover split with one bottom sheet — see
 * below) — replaces the per-mode ShareCard/ChallengeCard pairs
 * (Daily/Practice/Rush) and ChallengeComparison's inline counter-challenge
 * button with one component.
 *
 * 2b.11 (share buried below the mobile feedback drawer, 2026-08-21): this
 * used to degrade to a plain inline button for one action, or a small
 * trigger + anchored popover for two — fine in normal page flow, but
 * PracticePage rendered it as ordinary content right after the puzzle card,
 * and on mobile the feedback drawer (PuzzleCardShell.tsx) sits `sticky`
 * over that same flow, so the menu ended up squeezed into a barely-visible
 * sliver below the drawer, above the footer/bottom nav — reachable in
 * theory, invisible in practice (confirmed on-device). Fix: one trigger,
 * one full-width bottom sheet, always — no more special-cased single-action
 * state to special-case a fix around. `PuzzleCardShell` now threads a
 * `shareActions` prop straight into its drawer footer (trigger="icon",
 * beside Continue) so the trigger is never further away than the verdict
 * itself; every other call site (Daily/Rush/Challenge, none of which were
 * ever buried) gets the same sheet automatically since it's the only
 * rendering path left, for one consistent interaction app-wide.
 *
 * Every action renders as a full-width sheet row: `[label + optional
 * description][copy-icon button]`. The label tries native share first
 * (mobile Web Share API), falling back to clipboard-copy on any rejection
 * other than the user cancelling. The copy-icon button always force-copies
 * to the clipboard — desktop browsers can still expose `navigator.share`
 * (e.g. Windows' Chrome/Edge share flyout), so this gives desktop users an
 * explicit, guaranteed "just copy the link" path that doesn't depend on
 * what the OS share sheet offers. Both paths confirm the same way: the
 * label swaps to `copiedLabel`. Copying deliberately does NOT close the
 * sheet (a copy-then-share-a-second-link-elsewhere flow shouldn't get cut
 * short); a successful native share does, matching what closing the OS
 * share sheet itself already feels like.
 *
 * Body scroll is locked while the sheet is open — a standard modal pattern,
 * and it has a second benefit here: it sidesteps the exact WKWebView
 * `position: fixed` bug class this app just fixed for BottomNav/the
 * interaction-filter row (see index.css's `body` comment) by construction —
 * nothing scrolls at the document level while this fixed-position sheet is
 * up.
 */
import { useEffect, useRef, useState } from 'react'
import { CopyIcon, ShareIcon } from './Icons'

export interface ShareAction {
  /** Stable identity for this action within one ShareMenu instance (e.g. 'puzzle' | 'challenge'). */
  id: string
  label: string
  /** Shown in place of `label` once either path (native share or a copy) has completed. */
  copiedLabel: string
  /** Accessible name for this action's dedicated copy-icon button (e.g. "Copy puzzle link"). */
  copyAriaLabel: string
  /** Optional one-line context shown under `label` inside the sheet (e.g. "Copy a link to this exact puzzle"). Omit for a bare label row. */
  description?: string
  /** The full share/challenge string — passed to navigator.share, and to clipboard.writeText on both paths. */
  text: string
  /** Caller's telemetry hook — fired synchronously on click (either button), before the share/copy resolves (matches the pre-2b.4 cards' fire-on-click convention). */
  onShared: () => void
}

export interface ShareMenuProps {
  actions: readonly ShareAction[]
  /**
   * Trigger visual — both open the identical full-width bottom sheet.
   * `'button'` (default): icon + "Share" label, bordered chip — normal page
   * flow, where there's room for a labelled control (Daily/Rush's result
   * cards, Challenge's comparison screen, Practice's desktop feedback
   * panel). `'icon'`: compact icon-only button, sized for a tight footer row
   * — PuzzleCardShell's mobile drawer, beside Continue.
   */
  trigger?: 'button' | 'icon'
}

const TRIGGER_CLASS =
  'inline-flex items-center gap-1.5 min-h-11 py-2 px-3 rounded-sm border border-border bg-surface-1 text-accent font-semibold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

const ICON_TRIGGER_CLASS =
  'flex items-center justify-center shrink-0 min-w-11 min-h-11 rounded-sm border border-border bg-surface-1 text-accent cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

const ROW_LABEL_CLASS =
  'flex-1 text-left py-1 px-0 border-0 bg-transparent cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

const ROW_COPY_BUTTON_CLASS =
  'flex items-center justify-center shrink-0 w-11 h-11 border-0 bg-transparent text-text-2 hover:text-text-0 hover:bg-surface-2 rounded-sm cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

type ActivateResult = 'shared' | 'copied'

async function activate(action: ShareAction): Promise<ActivateResult> {
  action.onShared()
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text: action.text })
      return 'shared'
    } catch (err) {
      // User-cancelled sheets are a normal outcome, not a failure to
      // recover from — only a real error falls through to clipboard.
      if (err instanceof Error && err.name === 'AbortError') return 'shared'
    }
  }
  await navigator.clipboard.writeText(action.text)
  return 'copied'
}

async function copyDirectly(action: ShareAction): Promise<void> {
  action.onShared()
  await navigator.clipboard.writeText(action.text)
}

interface SheetRowProps {
  action: ShareAction
  copied: boolean
  onActivated: (result: ActivateResult) => void
  onCopied: () => void
}

function SheetRow({ action, copied, onActivated, onCopied }: SheetRowProps) {
  const currentLabel = copied ? action.copiedLabel : action.label
  // `aria-label` is what actually fixes the button's computed accessible
  // name — a plain nested description <span> folds its own text into that
  // name via subtree content (`aria-describedby` alone doesn't prevent
  // that; it only adds a *description*, name computation still falls
  // through to content when there's no explicit name). Explicitly naming
  // the button keeps it exactly `currentLabel`, matching every caller's
  // exact-name lookups (`getByRole('button', { name: 'Share puzzle' })`).
  // The label span is aria-hidden as a result (redundant with aria-label),
  // but the description span stays in the accessibility tree, wired via
  // aria-describedby, so screen-reader users still get that context —
  // just as the description, not folded into the name.
  const descriptionId = action.description ? `share-action-desc-${action.id}` : undefined
  return (
    <div className="flex items-center gap-2 py-1 first:pt-0 last:pb-0 border-t border-border first:border-t-0">
      <button
        type="button"
        className={ROW_LABEL_CLASS}
        aria-label={currentLabel}
        aria-describedby={descriptionId}
        onClick={() => {
          void activate(action).then(onActivated)
        }}
      >
        <span className="block font-semibold text-text-0" aria-hidden="true">
          {currentLabel}
        </span>
        {action.description && (
          <span id={descriptionId} className="block text-sm text-text-1 mt-0.5">
            {action.description}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={action.copyAriaLabel}
        className={ROW_COPY_BUTTON_CLASS}
        onClick={() => {
          void copyDirectly(action).then(onCopied)
        }}
      >
        <CopyIcon size={16} />
      </button>
    </div>
  )
}

export function ShareMenu({ actions, trigger = 'button' }: ShareMenuProps) {
  const [open, setOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    // Standard modal body-scroll lock — also the mechanism that keeps this
    // fixed-position sheet clear of the WKWebView bug class described in
    // this file's doc comment: nothing scrolls at the document level while
    // it's open, so there's nothing for that bug to trigger on.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (actions.length === 0) return null

  return (
    <>
      {trigger === 'icon' ? (
        <button
          type="button"
          className={ICON_TRIGGER_CLASS}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Share"
          onClick={() => {
            setCopiedId(null)
            setOpen(true)
          }}
        >
          <ShareIcon size={20} />
        </button>
      ) : (
        <button
          type="button"
          className={TRIGGER_CLASS}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setCopiedId(null)
            setOpen(true)
          }}
        >
          <ShareIcon size={18} />
          Share
        </button>
      )}
      {open && (
        // `items-end` + a full-viewport scrim is what makes this a bottom
        // sheet instead of a centered dialog — matches the approved mockup.
        // Click-to-dismiss lives on the scrim itself; `stopPropagation` on
        // the sheet keeps a tap inside it from bubbling to that handler.
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/55"
          onClick={() => {
            setOpen(false)
          }}
        >
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Share"
            className="w-full max-w-[var(--content-width-mobile)] flex flex-col gap-0.5 bg-surface-1 border border-border border-b-0 rounded-t-lg shadow-lg p-4 pb-[calc(var(--space-4)+env(safe-area-inset-bottom))]"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <div className="w-9 h-1 rounded-full bg-border self-center mb-3" aria-hidden="true" />
            <p className="m-0 mb-1 text-text-0 font-bold">Share</p>
            {actions.map((action) => (
              <SheetRow
                key={action.id}
                action={action}
                copied={copiedId === action.id}
                onActivated={(result) => {
                  if (result === 'copied') {
                    setCopiedId(action.id)
                  } else {
                    setOpen(false)
                  }
                }}
                onCopied={() => {
                  setCopiedId(action.id)
                }}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
