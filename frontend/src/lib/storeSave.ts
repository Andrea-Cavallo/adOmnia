const timers = new Map<string, ReturnType<typeof setTimeout>>()

// Default debounce delay, kept in sync with general.autoSaveIntervalMs by the
// settings store (set via a setter to avoid a circular import).
let autoSaveDelay = 250
export function setAutoSaveDelay(ms: number): void {
  autoSaveDelay = Math.min(Math.max(ms, 250), 60000)
}

export function debouncedSave(key: string, fn: () => Promise<void>, delay = autoSaveDelay): void {
  const existing = timers.get(key)
  if (existing) clearTimeout(existing)
  timers.set(key, setTimeout(async () => {
    timers.delete(key)
    try {
      await fn()
    } catch (e) {
      window.dispatchEvent(new CustomEvent('adomnia:save-error', {
        detail: e instanceof Error ? e.message : 'Save failed',
      }))
    }
  }, delay))
}
