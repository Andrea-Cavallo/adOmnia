const timers = new Map<string, ReturnType<typeof setTimeout>>()
const pending = new Map<string, () => Promise<void>>()
/** Keys whose data another window currently owns: saving them here would overwrite newer edits. */
const suspended = new Set<string>()

export function setSavesSuspended(keys: readonly string[], value: boolean): void {
  for (const key of keys) {
    if (value) {
      suspended.add(key)
      clearTimeout(timers.get(key))
      timers.delete(key)
      pending.delete(key)
    } else {
      suspended.delete(key)
    }
  }
}

// Default debounce delay, kept in sync with general.autoSaveIntervalMs by the
// settings store (set via a setter to avoid a circular import).
let autoSaveDelay = 250
export function setAutoSaveDelay(ms: number): void {
  autoSaveDelay = Math.min(Math.max(ms, 250), 60000)
}

export function debouncedSave(key: string, fn: () => Promise<void>, delay = autoSaveDelay): void {
  if (suspended.has(key)) return
  const existing = timers.get(key)
  if (existing) clearTimeout(existing)
  pending.set(key, fn)
  timers.set(key, setTimeout(() => void runSave(key), delay))
}

async function runSave(key: string): Promise<void> {
  const fn = pending.get(key)
  timers.delete(key)
  pending.delete(key)
  if (!fn) return
  try {
    await fn()
  } catch (e) {
    window.dispatchEvent(new CustomEvent('adomnia:save-error', {
      detail: e instanceof Error ? e.message : 'Save failed',
    }))
  }
}

/** Runs every queued save now: another window is about to read the same data from disk. */
export async function flushPendingSaves(): Promise<void> {
  const keys = [...timers.keys()]
  keys.forEach((key) => clearTimeout(timers.get(key)))
  await Promise.all(keys.map(runSave))
}
