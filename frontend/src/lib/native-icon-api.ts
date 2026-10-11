import { isDesktopRuntime } from './desktopRuntime'
import { SetNativeIconPalette } from '../../bindings/adomnia/app'

let desired: { mode: 'dark' | 'light'; accent: string } | null = null
let running = false
let applied = ''

// Coalesce slider previews; finish with the newest native icon rather than queueing every color.
export function syncNativeIcon(mode: 'dark' | 'light', accent = ''): void {
  if (!isDesktopRuntime()) return
  desired = { mode, accent }
  if (running) return
  running = true
  void (async () => {
    try {
      while (desired) {
        const next = desired
        desired = null
        const key = `${next.mode}:${next.accent}`
        if (key === applied) continue
        try { await SetNativeIconPalette(next.mode, next.accent); applied = key }
        catch (error) { console.warn('[native-icon] Could not update the taskbar icon', error) }
      }
    } finally { running = false }
  })()
}
