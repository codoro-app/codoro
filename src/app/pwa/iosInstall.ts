/**
 * iOS Safari has no `beforeinstallprompt` event (Chrome/Edge/Android's
 * install-prompt API), so there's no programmatic way to detect
 * installability or trigger install — the only path is Safari's own
 * Share -> Add to Home Screen sheet. IosInstallSheet just tells the user
 * how to do that manually, shown only where it's actually reachable: iOS
 * Safari itself, not already running standalone, and not one of the other
 * iOS browsers (Chrome/Firefox/Edge-on-iOS) that are Safari underneath but
 * don't expose the same Add to Home Screen flow.
 *
 * Takes an explicit environment object rather than reading navigator/window
 * directly so detection logic is pure and unit-testable without jsdom
 * UA-string gymnastics.
 */
export interface IosEnvironment {
  userAgent: string
  maxTouchPoints: number
  isStandalone: boolean
}

const IOS_DEVICE_PATTERN = /iphone|ipad|ipod/i
// iPadOS 13+ reports a desktop Mac user agent; touch points is the tell.
const IPADOS_DESKTOP_UA_PATTERN = /macintosh/i
const NON_SAFARI_IOS_BROWSER_PATTERN = /crios|fxios|edgios|opios|duckduckgo/i

export function shouldShowIosInstallSheet(env: IosEnvironment): boolean {
  if (env.isStandalone) return false

  const isIosDevice =
    IOS_DEVICE_PATTERN.test(env.userAgent) ||
    (IPADOS_DESKTOP_UA_PATTERN.test(env.userAgent) && env.maxTouchPoints > 1)
  if (!isIosDevice) return false

  return !NON_SAFARI_IOS_BROWSER_PATTERN.test(env.userAgent)
}

export function currentIosEnvironment(): IosEnvironment {
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    isStandalone:
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  }
}
