import { afterEach, describe, expect, it, vi } from 'vitest'
import { minuteAlignedTimeout, visibleInterval } from './visiblePolling'

function fakeDom() {
  const intervals = new Map<number, () => void>()
  const listeners: Record<string, Array<() => void>> = {}
  let nextId = 1
  const document = {
    hidden: false,
    addEventListener: (type: string, listener: () => void) => {
      listeners[type] = [...(listeners[type] ?? []), listener]
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners[type] = (listeners[type] ?? []).filter((item) => item !== listener)
    },
  }
  const window = {
    setInterval: (callback: () => void) => {
      const id = nextId++
      intervals.set(id, callback)
      return id
    },
    clearInterval: (id: number) => {
      intervals.delete(id)
    },
    // Delega ai timer globali: con i fake timer di vitest restano guidabili.
    setTimeout: (callback: () => void, ms?: number) => globalThis.setTimeout(callback, ms),
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
  }
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', window)
  return {
    intervals,
    tickIntervals: () => {
      for (const callback of intervals.values()) callback()
    },
    fireVisibilityChange: () => {
      for (const listener of listeners.visibilitychange ?? []) listener()
    },
    visibilityListeners: () => (listeners.visibilitychange ?? []).length,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('visibleInterval', () => {
  it('runs ticks while the window is visible', () => {
    const dom = fakeDom()
    let calls = 0
    const stop = visibleInterval(() => { calls += 1 }, 1000)

    dom.tickIntervals()
    dom.tickIntervals()
    expect(calls).toBe(2)
    stop()
  })

  it('skips ticks while the window is hidden and refreshes immediately on return', () => {
    const dom = fakeDom()
    let calls = 0
    const stop = visibleInterval(() => { calls += 1 }, 1000)
    const hidden = globalThis.document as unknown as { hidden: boolean }

    hidden.hidden = true
    dom.tickIntervals()
    dom.tickIntervals()
    expect(calls).toBe(0)

    dom.fireVisibilityChange()
    expect(calls).toBe(0)

    hidden.hidden = false
    dom.fireVisibilityChange()
    expect(calls).toBe(1)

    dom.tickIntervals()
    expect(calls).toBe(2)
    stop()
  })

  it('clears the interval and the visibility listener on cleanup', () => {
    const dom = fakeDom()
    const stop = visibleInterval(() => undefined, 1000)
    expect(dom.intervals.size).toBe(1)
    expect(dom.visibilityListeners()).toBe(1)

    stop()
    expect(dom.intervals.size).toBe(0)
    expect(dom.visibilityListeners()).toBe(0)
  })
})

describe('minuteAlignedTimeout', () => {
  it('fires at the next minute boundary and then once per minute', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T10:30:15.000Z'))
    const dom = fakeDom()
    let calls = 0
    const stop = minuteAlignedTimeout(() => { calls += 1 })

    vi.advanceTimersByTime(44_000)
    expect(calls).toBe(0)
    vi.advanceTimersByTime(1_000)
    expect(calls).toBe(1)

    vi.advanceTimersByTime(59_000)
    expect(calls).toBe(1)
    vi.advanceTimersByTime(1_000)
    expect(calls).toBe(2)

    stop()
    vi.advanceTimersByTime(120_000)
    expect(calls).toBe(2)
    expect(dom.intervals.size).toBe(0)
  })
})
