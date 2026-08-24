/**
 * Clean-profile Lighthouse runner for /practice (perf pass 2026-08-24,
 * Task 0). The two JSON reports this pass started from were captured in a
 * Chrome profile with ~12 extensions loaded (MetaMask, Adobe Acrobat,
 * AdBlock, an LMS-detector, others) — every `unused-javascript` entry but
 * two, all four `errors-in-console` items, and the `deprecations` warning
 * traced straight back to those extensions, not to this app (see
 * docs/perf-baseline-2026-08-24.md). This script launches a genuinely clean
 * headless Chrome (`--disable-extensions`) so every number it reports is
 * first-party.
 *
 * Usage:
 *   pnpm perf:lighthouse                 # pnpm build, then serves+audits localhost
 *   pnpm perf:lighthouse -- --prod       # audits https://getcodoro.com/practice directly
 *   pnpm perf:lighthouse -- --url=<url>  # audits an arbitrary URL, no local build/serve
 *
 * Runs each form factor (mobile, desktop) 3x and reports the MEDIAN of
 * Performance score / FCP / LCP / TBT / CLS — a single run's TBT in
 * particular varies +/-30% run to run; never report or compare a single run
 * anywhere in this pass.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import * as chromeLauncher from 'chrome-launcher'
import lighthouse from 'lighthouse'

const PORT = 4173
const RUNS_PER_FORM_FACTOR = 3

interface FormFactorSettings {
  formFactor: 'mobile' | 'desktop'
  screenEmulation: {
    mobile: boolean
    width: number
    height: number
    deviceScaleFactor: number
    disabled: boolean
  }
  throttling: {
    rttMs: number
    throughputKbps: number
    cpuSlowdownMultiplier: number
    requestLatencyMs: number
    downloadThroughputKbps: number
    uploadThroughputKbps: number
  }
}

// Lighthouse's own default mobile ("Slow 4G" + Moto G4-class CPU) and
// desktop (effectively unthrottled) presets, written out explicitly rather
// than imported from Lighthouse's internal desktop-config module (that
// module's path has moved across major versions — these throttling numbers
// are the stable, publicly-documented part of the config API). VERIFY these
// still match node_modules/lighthouse/core/config/constants.js after
// `pnpm install` runs Step 1 above — don't just trust this comment.
const MOBILE: FormFactorSettings = {
  formFactor: 'mobile',
  screenEmulation: {
    mobile: true,
    width: 412,
    height: 823,
    deviceScaleFactor: 1.75,
    disabled: false,
  },
  throttling: {
    rttMs: 150,
    throughputKbps: 1638.4,
    cpuSlowdownMultiplier: 4,
    requestLatencyMs: 0,
    downloadThroughputKbps: 0,
    uploadThroughputKbps: 0,
  },
}

const DESKTOP: FormFactorSettings = {
  formFactor: 'desktop',
  screenEmulation: {
    mobile: false,
    width: 1350,
    height: 940,
    deviceScaleFactor: 1,
    disabled: false,
  },
  throttling: {
    rttMs: 40,
    throughputKbps: 10240,
    cpuSlowdownMultiplier: 1,
    requestLatencyMs: 0,
    downloadThroughputKbps: 0,
    uploadThroughputKbps: 0,
  },
}

interface RunMetrics {
  performance: number
  fcp: number
  lcp: number
  tbt: number
  cls: number
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0)
}

async function runOnce(
  url: string,
  port: number,
  settings: FormFactorSettings,
): Promise<RunMetrics> {
  const result = await lighthouse(
    url,
    { port, output: 'json', logLevel: 'error' },
    { extends: 'lighthouse:default', settings },
  )
  if (!result) {
    throw new Error(`Lighthouse run returned no result for ${url}`)
  }
  const { audits, categories } = result.lhr
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const performance = categories.performance?.score
  if (typeof performance !== 'number') {
    throw new Error('Lighthouse run produced no performance score')
  }
  const auditsMap = audits as Record<string, { numericValue?: number }>
  return {
    performance,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    fcp: auditsMap['first-contentful-paint']?.numericValue ?? NaN,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    lcp: auditsMap['largest-contentful-paint']?.numericValue ?? NaN,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    tbt: auditsMap['total-blocking-time']?.numericValue ?? NaN,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    cls: auditsMap['cumulative-layout-shift']?.numericValue ?? NaN,
  }
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) return
    } catch {
      // not up yet — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(
    `Local preview server at ${url} did not become ready within ${String(timeoutMs)}ms`,
  )
}

/**
 * Cross-platform tree-kill for a child process. On Windows, uses taskkill /T /F
 * to kill the entire process tree (matches chrome-launcher's approach). On POSIX,
 * uses process group kill (only works if the child was spawned with detached: true).
 * Also attempts direct process.kill() as a fallback.
 */
function killProcessTree(pid: number | undefined): void {
  if (!pid) return
  try {
    if (process.platform === 'win32') {
      // Windows: taskkill /T recursively kills all children of this PID, /F forces termination
      // The PID here is actually cmd.exe when spawned with shell: true, but taskkill /T
      // still reaches all descendant processes (pnpm -> node -> vite processes)
      try {
        execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
      } catch {
        // Process may have already exited; that's fine
      }
      // Also try killing by process.kill as a backup
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // Already dead
      }
    } else {
      // POSIX: kill the entire process group (only works if spawned detached: true)
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        // Process may have already exited
      }
    }
  } catch {
    // Silently ignore any cleanup errors; we're in the finally block
  }
}

function reportTable(label: string, runs: RunMetrics[]): RunMetrics {
  const med: RunMetrics = {
    performance: median(runs.map((r) => r.performance)),
    fcp: median(runs.map((r) => r.fcp)),
    lcp: median(runs.map((r) => r.lcp)),
    tbt: median(runs.map((r) => r.tbt)),
    cls: median(runs.map((r) => r.cls)),
  }
  console.log(`\n${label} — median of ${String(runs.length)} runs`)
  console.log(`  Performance: ${(med.performance * 100).toFixed(0)}`)
  console.log(`  FCP:         ${med.fcp.toFixed(0)} ms`)
  console.log(`  LCP:         ${med.lcp.toFixed(0)} ms`)
  console.log(`  TBT:         ${med.tbt.toFixed(0)} ms`)
  console.log(`  CLS:         ${med.cls.toFixed(3)}`)
  return med
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const useProd = args.includes('--prod')
  const urlArg = args.find((a) => a.startsWith('--url='))
  const explicitUrl = urlArg?.slice('--url='.length)

  let previewProcess: ChildProcess | null = null
  let targetUrl: string

  if (explicitUrl) {
    targetUrl = explicitUrl
  } else if (useProd) {
    targetUrl = 'https://getcodoro.com/practice'
  } else {
    console.log('Building production bundle...')
    execFileSync('pnpm', ['build'], { stdio: 'inherit', shell: true })
    console.log(`Starting local preview server on port ${String(PORT)}...`)
    // On Windows, shell: true wraps the process in cmd.exe, which prevents normal .kill()
    // from reaching descendant processes. On POSIX, use detached: true so killProcessTree's
    // process group kill works. The killProcessTree function handles the actual cleanup.
    previewProcess = spawn('pnpm', ['preview', '--port', String(PORT), '--strictPort'], {
      stdio: 'inherit',
      shell: true,
      detached: process.platform !== 'win32',
    })
    targetUrl = `http://localhost:${String(PORT)}/practice`
    await waitForServer(targetUrl, 30_000)
  }

  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless=new', '--disable-extensions', '--no-sandbox'],
  })

  try {
    const mobileRuns: RunMetrics[] = []
    for (let i = 0; i < RUNS_PER_FORM_FACTOR; i++) {
      mobileRuns.push(await runOnce(targetUrl, chrome.port, MOBILE))
    }
    const desktopRuns: RunMetrics[] = []
    for (let i = 0; i < RUNS_PER_FORM_FACTOR; i++) {
      desktopRuns.push(await runOnce(targetUrl, chrome.port, DESKTOP))
    }

    console.log(`\nTarget: ${targetUrl}`)
    reportTable('Mobile', mobileRuns)
    reportTable('Desktop', desktopRuns)
    console.log(
      '\nCopy these medians into docs/perf-baseline-2026-08-24.md by hand — this script deliberately does not auto-write the committed baseline doc.',
    )
  } finally {
    chrome.kill()
    killProcessTree(previewProcess?.pid)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
