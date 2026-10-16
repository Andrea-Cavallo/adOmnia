/**
 * Vitest setup: silences the @wailsio/runtime "Browser Environment Detected"
 * banner. The runtime prints it at import time whenever no Wails webview bridge
 * is present, which under Vitest is always true — one copy per test file that
 * touches the runtime adds nothing but noise to the suite output.
 *
 * Only that exact banner is filtered; every other console.warn still reaches
 * the test log unchanged. Installed idempotently so re-running setup files in
 * the same worker (isolated per test file) does not stack wrapper layers.
 */

const WAILS_BROWSER_BANNER = 'Browser Environment Detected'

type Warn = typeof console.warn & { filtersWailsBrowserBanner?: boolean }

const warn: Warn = console.warn
if (!warn.filtersWailsBrowserBanner) {
  const filtered: Warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes(WAILS_BROWSER_BANNER)) return
    warn(...args)
  }
  filtered.filtersWailsBrowserBanner = true
  console.warn = filtered
}
