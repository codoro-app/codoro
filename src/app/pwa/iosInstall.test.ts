import { describe, expect, it } from 'vitest'
import { shouldShowIosInstallSheet } from './iosInstall'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IPAD_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1'
const IPHONE_FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15'
const MACOS_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'

describe('shouldShowIosInstallSheet', () => {
  it('shows for iPhone Safari, not yet installed', () => {
    expect(
      shouldShowIosInstallSheet({
        userAgent: IPHONE_SAFARI,
        maxTouchPoints: 5,
        isStandalone: false,
      }),
    ).toBe(true)
  })

  it('shows for iPad Safari (desktop UA + touch points), not yet installed', () => {
    expect(
      shouldShowIosInstallSheet({ userAgent: IPAD_SAFARI, maxTouchPoints: 5, isStandalone: false }),
    ).toBe(true)
  })

  it('does not show once already running standalone (installed)', () => {
    expect(
      shouldShowIosInstallSheet({
        userAgent: IPHONE_SAFARI,
        maxTouchPoints: 5,
        isStandalone: true,
      }),
    ).toBe(false)
  })

  it('does not show for Chrome on iOS (CriOS) — no Add to Home Screen flow of its own', () => {
    expect(
      shouldShowIosInstallSheet({
        userAgent: IPHONE_CHROME,
        maxTouchPoints: 5,
        isStandalone: false,
      }),
    ).toBe(false)
  })

  it('does not show for Firefox on iOS (FxiOS)', () => {
    expect(
      shouldShowIosInstallSheet({
        userAgent: IPHONE_FIREFOX,
        maxTouchPoints: 5,
        isStandalone: false,
      }),
    ).toBe(false)
  })

  it('does not show for desktop macOS Safari (no touch points, real Mac)', () => {
    expect(
      shouldShowIosInstallSheet({
        userAgent: MACOS_SAFARI,
        maxTouchPoints: 0,
        isStandalone: false,
      }),
    ).toBe(false)
  })

  it('does not show for Android Chrome (uses beforeinstallprompt instead)', () => {
    expect(
      shouldShowIosInstallSheet({
        userAgent: ANDROID_CHROME,
        maxTouchPoints: 5,
        isStandalone: false,
      }),
    ).toBe(false)
  })
})
