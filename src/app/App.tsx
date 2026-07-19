import { ErrorBoundary } from './ErrorBoundary'
import { PracticePage } from './practice/PracticePage'

export function App() {
  return (
    <ErrorBoundary>
      <main>
        <PracticePage />
      </main>
    </ErrorBoundary>
  )
}
