import { useState } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { PracticePage } from './practice/PracticePage'
import { DailyPage } from './daily/DailyPage'
import { PwaPrompts } from './pwa/PwaPrompts'
import { ModeSwitcher } from './ModeSwitcher'
import type { AppMode } from './ModeSwitcher'

export function App() {
  const [mode, setMode] = useState<AppMode>('practice')

  return (
    <ErrorBoundary>
      <main>
        <ModeSwitcher mode={mode} onChange={setMode} />
        {mode === 'practice' ? <PracticePage /> : <DailyPage />}
      </main>
      <PwaPrompts />
    </ErrorBoundary>
  )
}
