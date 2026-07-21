import { useState } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { PracticePage } from './practice/PracticePage'
import { DailyPage } from './daily/DailyPage'
import { PwaPrompts } from './pwa/PwaPrompts'
import { AppShell } from './AppShell'
import type { AppMode } from './ModeSwitcher'

export function App() {
  const [mode, setMode] = useState<AppMode>('practice')

  return (
    <ErrorBoundary>
      <AppShell mode={mode} onModeChange={setMode}>
        {mode === 'practice' ? <PracticePage /> : <DailyPage />}
      </AppShell>
      <PwaPrompts />
    </ErrorBoundary>
  )
}
