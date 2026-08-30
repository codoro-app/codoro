/**
 * "Add Codoro to your Home Screen" instructions for iOS Safari — the only
 * install path there (see iosInstall.ts's doc comment for why there's no
 * programmatic install prompt to trigger instead).
 *
 * Presentational: visibility and dismiss come from the caller (PwaPrompts),
 * same reasoning as UpdatePrompt — see its doc comment.
 */
import { Tooltip } from '../Tooltip'
// 2b.0: was `.update-prompt, .ios-install-sheet` shared base (pwa.css) —
// duplicated here rather than a shared module (matches UpdatePrompt.tsx's
// own copy; no shared component exists for two 2-line-different overlays).
const SHEET_BASE_CLASS =
  'fixed left-0 right-0 bottom-0 z-[100] py-3.5 px-4 pb-[calc(var(--space-3-5)+env(safe-area-inset-bottom))] bg-surface-1 border-t border-border'

export interface IosInstallSheetProps {
  onDismiss: () => void
}

export function IosInstallSheet({ onDismiss }: IosInstallSheetProps) {
  return (
    <div
      className={`${SHEET_BASE_CLASS} flex flex-col gap-3`}
      role="dialog"
      aria-label="Install Codoro"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="m-0 text-text-0 text-lg font-bold">Install Codoro on your device</p>
        <Tooltip label="Dismiss">
          <button
            type="button"
            className="min-w-11 min-h-11 flex items-center justify-center border-0 bg-transparent text-text-1 text-2xl leading-none cursor-pointer"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </Tooltip>
      </div>
      <ol className="m-0 p-0 list-none flex flex-col gap-2">
        <li className="flex items-center gap-2.5 text-text-0 text-md leading-[1.4]">
          <span className="flex-none text-xl" aria-hidden="true">
            📤
          </span>
          <span>Tap the Share button in Safari's toolbar</span>
        </li>
        <li className="flex items-center gap-2.5 text-text-0 text-md leading-[1.4]">
          <span className="flex-none text-xl" aria-hidden="true">
            ➕
          </span>
          <span>Scroll down and tap "Add to Home Screen"</span>
        </li>
        <li className="flex items-center gap-2.5 text-text-0 text-md leading-[1.4]">
          <span className="flex-none text-xl" aria-hidden="true">
            ✅
          </span>
          <span>Tap "Add" to confirm</span>
        </li>
      </ol>
    </div>
  )
}
