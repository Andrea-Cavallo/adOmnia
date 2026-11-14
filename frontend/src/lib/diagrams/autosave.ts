/**
 * Debounced autosave that never loses the last change: saves run one at a time, a change made during
 * a save is saved right after it, `flush` saves now (before switching diagram or closing), and a
 * failure is reported and retried with the next change instead of being swallowed.
 */
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'

export interface AutosaveOptions<T> {
  delayMs: number
  save: (value: T) => Promise<void>
  onStatus: (status: SaveStatus, error?: string) => void
}

export interface Autosave<T> {
  schedule: (value: T) => void
  flush: () => Promise<void>
  cancel: () => void
}

export function createAutosave<T>({ delayMs, save, onStatus }: AutosaveOptions<T>): Autosave<T> {
  let pending: { value: T } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const run = async (): Promise<void> => {
    clearTimer()
    if (running) { await running; return run() }
    if (!pending) return
    const { value } = pending
    pending = null
    onStatus('saving')
    running = save(value)
      .then(() => onStatus(pending ? 'pending' : 'saved'))
      .catch((error: unknown) => {
        // Keep the unsaved value unless a newer one replaced it: the next change or flush retries.
        pending ??= { value }
        onStatus('error', error instanceof Error ? error.message : String(error))
      })
      .finally(() => { running = null })
    await running
  }

  return {
    schedule(value) {
      pending = { value }
      onStatus('pending')
      clearTimer()
      timer = setTimeout(() => { void run() }, delayMs)
    },
    async flush() {
      if (running) await running
      if (pending) await run()
    },
    cancel() {
      clearTimer()
      pending = null
    },
  }
}
