import { ErrorBoundary } from './ErrorBoundary'

export function App() {
  return (
    <ErrorBoundary>
      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          textAlign: 'center',
          gap: '0.5rem',
        }}
      >
        <h1>Codoro</h1>
        <p>Coding puzzles for spotting bugs. Coming soon.</p>
      </main>
    </ErrorBoundary>
  )
}
