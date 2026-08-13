/**
 * Consolidated share/challenge affordance (v3 Phase 2b.4) — replaces the
 * per-mode ShareCard/ChallengeCard pairs (Daily/Practice/Rush) and
 * ChallengeComparison's inline counter-challenge button with one component.
 * Degrades to a single plain button when only one action applies (no menu
 * chrome); with two actions, a compact "Share" trigger opens a small
 * popover listing both. Native share (mobile Web Share API) is tried first
 * per action; a rejection other than the user cancelling falls back to
 * clipboard-copy, confirmed via an inline label swap to `copiedLabel`.
 */
import { useEffect, useRef, useState } from 'react'
import { ShareIcon } from './Icons'

export interface ShareAction {
  /** Stable identity for this action within one ShareMenu instance (e.g. 'puzzle' | 'challenge'). */
  id: string
  label: string
  /** Shown in place of `label` once a clipboard-fallback copy has succeeded. */
  copiedLabel: string
  /** The full share/challenge string — passed to both navigator.share and clipboard.writeText. */
  text: string
  /** Caller's telemetry hook — fired synchronously on click, before the share/copy resolves (matches the pre-2b.4 cards' fire-on-click convention). */
  onShared: () => void
}

export interface ShareMenuProps {
  actions: readonly ShareAction[]
}

const TRIGGER_CLASS =
  'inline-flex items-center gap-1.5 min-h-11 py-2 px-3 rounded-sm border border-border bg-surface-1 text-accent font-semibold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

const ITEM_CLASS =
  'min-h-11 w-full text-left py-2 px-3 border-0 bg-transparent text-text-0 font-semibold cursor-pointer rounded-sm hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

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
    const isCopied = copiedId === action.id
    return (
      <button
        type="button"
        className={TRIGGER_CLASS}
        onClick={() => {
          void activate(action).then((result) => {
            if (result === 'copied') setCopiedId(action.id)
          })
        }}
      >
        {isCopied ? action.copiedLabel : action.label}
      </button>
    )
  }

  return (
    <div className="relative inline-block" ref={containerRef}>
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
          className="absolute right-0 mt-1 min-w-[10rem] flex flex-col gap-0.5 p-1 rounded-lg bg-surface-1 border border-border shadow-lg z-10"
        >
          {actions.map((action) => {
            const isCopied = copiedId === action.id
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className={ITEM_CLASS}
                onClick={() => {
                  void activate(action).then((result) => {
                    if (result === 'copied') {
                      setCopiedId(action.id)
                    } else {
                      setOpen(false)
                    }
                  })
                }}
              >
                {isCopied ? action.copiedLabel : action.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
