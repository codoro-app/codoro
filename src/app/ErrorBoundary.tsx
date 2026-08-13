import { Component, type ErrorInfo, type ReactNode } from 'react'
import { trackError } from '../telemetry'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * Whole-app render error boundary. Only a class component can implement
 * getDerivedStateFromError/componentDidCatch — there is no hooks equivalent.
 *
 * On catching a render error: show a minimal, friendly fallback (never a
 * blank screen, never a raw stack trace to the user) and report the error
 * through the telemetry choke point so it shows up in PostHog.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    trackError(error, info.componentStack ?? 'ErrorBoundary')
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100dvh',
            textAlign: 'center',
            gap: '0.5rem',
          }}
        >
          <h1>Something went wrong</h1>
          <p>Sorry about that — please refresh the page and try again.</p>
        </main>
      )
    }

    return this.props.children
  }
}
