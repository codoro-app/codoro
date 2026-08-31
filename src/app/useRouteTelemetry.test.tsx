import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRouteTelemetry } from './useRouteTelemetry'

const trackRouteView = vi.fn()

vi.mock('../telemetry', () => ({
  trackRouteView: (...args: unknown[]) => {
    trackRouteView(...args)
  },
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('useRouteTelemetry', () => {
  it('fires route_view on the very first render (unlike useRouteFocusAndScroll, which skips it)', () => {
    window.history.pushState({}, '', '/practice')
    renderHook(() => {
      useRouteTelemetry()
    })
    expect(trackRouteView).toHaveBeenCalledTimes(1)
    expect(trackRouteView).toHaveBeenCalledWith({ route: '/practice' })
  })

  it('does not re-fire on a re-render at the same route', () => {
    window.history.pushState({}, '', '/practice')
    const { rerender } = renderHook(() => {
      useRouteTelemetry()
    })
    expect(trackRouteView).toHaveBeenCalledTimes(1)
    rerender()
    rerender()
    expect(trackRouteView).toHaveBeenCalledTimes(1)
  })

  it('fires exactly once per distinct route change', () => {
    window.history.pushState({}, '', '/practice')
    const first = renderHook(() => {
      useRouteTelemetry()
    })
    expect(trackRouteView).toHaveBeenCalledTimes(1)
    // Unmount before navigating: wouter's location state is a global
    // subscription, so a still-mounted first instance would otherwise react
    // to the pushState below too (its own ref still holding '/practice'),
    // double-counting this route change — AppShell only ever has one
    // mounted instance in the real app.
    first.unmount()

    window.history.pushState({}, '', '/daily')
    renderHook(() => {
      useRouteTelemetry()
    })
    expect(trackRouteView).toHaveBeenCalledTimes(2)
    expect(trackRouteView).toHaveBeenLastCalledWith({ route: '/daily' })
  })

  it('maps a dynamic /puzzle/<id> path to the /puzzle/:id pattern, never the raw id', () => {
    window.history.pushState({}, '', '/puzzle/tc-009')
    renderHook(() => {
      useRouteTelemetry()
    })
    expect(trackRouteView).toHaveBeenCalledWith({ route: '/puzzle/:id' })
    const [payload] = trackRouteView.mock.calls[0] as [{ route: string }]
    expect(payload.route).not.toContain('tc-009')
  })

  it('reports /challenge as its own literal pattern, never a query string carrying challenge payload data', () => {
    window.history.pushState({}, '', '/challenge?p=eyJ2IjoxfQ')
    renderHook(() => {
      useRouteTelemetry()
    })
    expect(trackRouteView).toHaveBeenCalledWith({ route: '/challenge' })
    const [payload] = trackRouteView.mock.calls[0] as [{ route: string }]
    expect(payload.route).toBe('/challenge')
    expect(payload.route).not.toContain('?')
    expect(payload.route).not.toContain('eyJ2IjoxfQ')
  })

  it('reports "unknown" for an unrecognized path, never the raw path', () => {
    window.history.pushState({}, '', '/totally-not-a-route')
    renderHook(() => {
      useRouteTelemetry()
    })
    expect(trackRouteView).toHaveBeenCalledWith({ route: 'unknown' })
  })
})
