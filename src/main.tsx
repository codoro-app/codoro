import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './app/App'
import { initTelemetry, trackSessionStart } from './telemetry'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found in index.html')
}

initTelemetry()
trackSessionStart()

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
