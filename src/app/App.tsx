import { ErrorBoundary } from './ErrorBoundary'
import { PracticePage } from './practice/PracticePage'
import { PwaPrompts } from './pwa/PwaPrompts'

export function App() {
  return (
    <ErrorBoundary>
      <main>
        <PracticePage />
      </main>
      <PwaPrompts />
    </ErrorBoundary>
  )
}
