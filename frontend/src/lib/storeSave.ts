const timers = new Map<string, ReturnType<typeof setTimeout>>()

export function debouncedSave(key: string, fn: () => Promise<void>, delay = 250): void {
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
