/**
 * Single mount point for both PWA overlays (App.tsx renders only this).
 * Owns useUpdatePrompt and useIosInstallPrompt so each hook registers
 * exactly once, and picks at most one banner to show — both are pinned to
 * the viewport bottom, so showing both at once would overlap. A pending
 * update wins: it's the rarer, time-sensitive case (a stale SW), while the
 * install nudge is low-stakes and can simply wait for the next render
 * where no update is pending.
 */
import { useUpdatePrompt } from './useUpdatePrompt'
import { useIosInstallPrompt } from './useIosInstallPrompt'
import { UpdatePrompt } from './UpdatePrompt'
import { IosInstallSheet } from './IosInstallSheet'

export function PwaPrompts() {
  const update = useUpdatePrompt()
  const install = useIosInstallPrompt()

  if (update.state !== 'idle') {
    return (
      <UpdatePrompt state={update.state} onRefresh={update.refresh} onDismiss={update.dismiss} />
    )
  }

  if (install.visible) {
    return <IosInstallSheet onDismiss={install.dismiss} />
  }

  return null
}
