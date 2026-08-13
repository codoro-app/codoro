/**
 * Consolidated share/challenge affordance (v3 Phase 2b.4; icon-copy split
 * added same phase per design-review follow-up) — replaces the per-mode
 * ShareCard/ChallengeCard pairs (Daily/Practice/Rush) and
 * ChallengeComparison's inline counter-challenge button with one component.
 * Degrades to a single inline action row when only one action applies (no
 * menu chrome); with two actions, a compact "Share" trigger opens a small
 * popover listing both.
 *
 * Every action renders as [label button][copy-icon button]. The label
 * tries native share first (mobile Web Share API), falling back to
 * clipboard-copy on any rejection other than the user cancelling. The
 * copy-icon button always force-copies to the clipboard — desktop browsers
 * can still expose `navigator.share` (e.g. Windows' Chrome/Edge share
 * flyout), so this gives desktop users an explicit, guaranteed "just copy
 * the link" path that doesn't depend on what the OS share sheet offers.
 * Both paths confirm the same way: the label swaps to `copiedLabel`.
 *
 * Positioning note: the two-action wrapper carries `self-start`. Without
 * it, a `flex flex-col` page shell (every caller's actual layout) stretches
 * the wrapper to the full column width via cross-axis `stretch`, and the
 * popover's `right-0` then resolves against that stretched box's edge
 * instead of the trigger's — visually anchoring the menu far from the
 * button it belongs to. `self-start` opts the wrapper out of that stretch.
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
  /** The full share/challenge string — passed to navigator.share, and to clipboard.writeText on both paths. */
  text: string
  /** Caller's telemetry hook — fired synchronously on click (either button), before the share/copy resolves (matches the pre-2b.4 cards' fire-on-click convention). */
  onShared: () => void
}

export interface ShareMenuProps {
  actions: readonly ShareAction[]
}

const TRIGGER_CLASS =
  'inline-flex items-center gap-1.5 min-h-11 py-2 px-3 rounded-sm border border-border bg-surface-1 text-accent font-semibold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

const LABEL_BUTTON_CLASS =
  'min-h-11 flex-1 text-left py-2 px-3 border-0 bg-transparent text-text-0 font-semibold cursor-pointer rounded-sm hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

const COPY_BUTTON_CLASS =
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

interface ActionRowProps {
  action: ShareAction
  copied: boolean
  /** True inside the popover — gives both buttons `role="menuitem"`. */
  menuItem: boolean
  /** True for the single-action (no popover) case — keeps this row from stretching to the page shell's full width. */
  alignSelfStart: boolean
  onActivated: (result: ActivateResult) => void
  onCopied: () => void
}

function ActionRow({
  action,
  copied,
  menuItem,
  alignSelfStart,
  onActivated,
  onCopied,
}: ActionRowProps) {
  const role = menuItem ? 'menuitem' : undefined
  return (
    <div className={`flex items-stretch gap-0.5${alignSelfStart ? ' self-start' : ''}`}>
      <button
        type="button"
        role={role}
        className={LABEL_BUTTON_CLASS}
        onClick={() => {
          void activate(action).then(onActivated)
        }}
      >
        {copied ? action.copiedLabel : action.label}
      </button>
      <button
        type="button"
        role={role}
        aria-label={action.copyAriaLabel}
        className={COPY_BUTTON_CLASS}
        onClick={() => {
          void copyDirectly(action).then(onCopied)
        }}
      >
        <CopyIcon size={16} />
      </button>
    </div>
  )
}

export function ShareMenu({ actions }: ShareMenuProps) {
  const [open, setOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  if (actions.length === 0) return null

  if (actions.length === 1) {
    const [action] = actions
    if (!action) return null
    return (
      <ActionRow
        action={action}
        copied={copiedId === action.id}
        menuItem={false}
        alignSelfStart
        onActivated={(result) => {
          if (result === 'copied') setCopiedId(action.id)
        }}
        onCopied={() => {
          setCopiedId(action.id)
        }}
      />
    )
  }

  return (
    <div className="relative inline-block self-start" ref={containerRef}>
      <button
        type="button"
        className={TRIGGER_CLASS}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setCopiedId(null)
          setOpen((wasOpen) => !wasOpen)
        }}
      >
        <ShareIcon size={18} />
        Share
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 min-w-[13rem] flex flex-col gap-0.5 p-1 rounded-lg bg-surface-1 border border-border shadow-lg z-10"
        >
          {actions.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              copied={copiedId === action.id}
              menuItem
              alignSelfStart={false}
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
      )}
    </div>
  )
}
