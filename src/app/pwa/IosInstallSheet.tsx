/**
 * "Add Codoro to your Home Screen" instructions for iOS Safari — the only
 * install path there (see iosInstall.ts's doc comment for why there's no
 * programmatic install prompt to trigger instead).
 *
 * Presentational: visibility and dismiss come from the caller (PwaPrompts),
 * same reasoning as UpdatePrompt — see its doc comment.
 */
import './pwa.css'

export interface IosInstallSheetProps {
  onDismiss: () => void
}

export function IosInstallSheet({ onDismiss }: IosInstallSheetProps) {
  return (
    <div className="ios-install-sheet" role="dialog" aria-label="Install Codoro">
      <div className="ios-install-sheet__header">
        <p className="ios-install-sheet__title">Install Codoro on your device</p>
        <button
          type="button"
          className="ios-install-sheet__close"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      <ol className="ios-install-sheet__steps">
        <li className="ios-install-sheet__step">
          <span className="ios-install-sheet__step-icon" aria-hidden="true">
            📤
          </span>
          <span>Tap the Share button in Safari's toolbar</span>
        </li>
        <li className="ios-install-sheet__step">
          <span className="ios-install-sheet__step-icon" aria-hidden="true">
            ➕
          </span>
          <span>Scroll down and tap "Add to Home Screen"</span>
        </li>
        <li className="ios-install-sheet__step">
          <span className="ios-install-sheet__step-icon" aria-hidden="true">
            ✅
          </span>
          <span>Tap "Add" to confirm</span>
        </li>
      </ol>
    </div>
  )
}
