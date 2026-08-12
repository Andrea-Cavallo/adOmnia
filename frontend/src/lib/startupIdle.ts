interface IdleDeadlineLike {
  didTimeout: boolean
  timeRemaining: () => number
}

interface IdleScheduler {
  setTimeout: (handler: () => void, timeout?: number) => number
  clearTimeout: (id: number) => void
  requestIdleCallback?: (
    handler: (deadline: IdleDeadlineLike) => void,
    options?: { timeout: number },
  ) => number
  cancelIdleCallback?: (id: number) => void
}

/** Schedule non-critical startup work without making requestIdleCallback a
 * hard browser requirement. The timeout guarantees eventual execution. */
export function scheduleStartupIdle(
  task: () => void,
  timeout = 1500,
  scheduler: IdleScheduler = window,
): () => void {
  let cancelled = false
  const run = () => {
    if (!cancelled) task()
  }

  if (scheduler.requestIdleCallback) {
    const id = scheduler.requestIdleCallback(run, { timeout })
    return () => {
      cancelled = true
      scheduler.cancelIdleCallback?.(id)
    }
  }

  const id = scheduler.setTimeout(run, 32)
  return () => {
    cancelled = true
    scheduler.clearTimeout(id)
  }
}
