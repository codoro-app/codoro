import { ErrorBoundary } from './ErrorBoundary'
import { PracticePage } from './practice/PracticePage'
import { UpdatePrompt } from './pwa/UpdatePrompt'

export function App() {
  return (
    <ErrorBoundary>
      <main>
        <PracticePage />
      </main>
      <UpdatePrompt />
    </ErrorBoundary>
  )
}
