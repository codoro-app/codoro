/**
 * Applies stored Preferences to the document root as data attributes — the
 * single place every preference's app-wide runtime effect lives, so
 * AppShell (on load) and SettingsPage (on save) both call this one function
 * rather than duplicating DOM-mutation logic. Pure DOM writes, no React
 * state: reducedMotion/theme/codeFontSize only ever need to affect CSS
 * (index.css's `[data-*]` selectors below), never a component re-render, so
 * a data attribute on `<html>` is the whole mechanism.
 *
 * `timerOnTrace` is deliberately NOT applied here: it isn't a global DOM
 * effect, it's a prop TracePage passes straight to TraceRunner — see
 * TracePage.tsx.
 */
import type { Preferences } from '../../storage'

export function applyPreferences(preferences: Preferences): void {
  const root = document.documentElement
  root.dataset.appTheme = preferences.theme
  root.dataset.reducedMotion = String(preferences.reducedMotion)
  root.dataset.codeFontSize = preferences.codeFontSize
}
