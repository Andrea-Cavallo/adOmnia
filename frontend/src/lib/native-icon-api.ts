import { isDesktopRuntime } from './desktopRuntime'
import { SetNativeIconMode } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/app'

let desired: { mode: 'dark' | 'light' } | null = null
let running = false
let applied = ''

// Preserve the original native artwork. Coalesce skin switches to the latest mode.
export function syncNativeIcon(mode: 'dark' | 'light'): void {
  if (!isDesktopRuntime()) return
  desired = { mode }
  if (running) return
  running = true
  void (async () => {
    try {
      while (desired) {
        const next = desired
        desired = null
        const key = next.mode
        if (key === applied) continue
        // oxlint-disable-next-line eslint/no-await-in-loop -- updates are applied one at a time, latest request wins
        try { await SetNativeIconMode(next.mode); applied = key }
        catch (error) { console.warn('[native-icon] Could not update the taskbar icon', error) }
      }
    } finally { running = false }
  })()
}
