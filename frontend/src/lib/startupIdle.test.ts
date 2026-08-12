import { describe, expect, it, vi } from 'vitest'
import { scheduleStartupIdle } from './startupIdle'

describe('startup idle scheduler', () => {
  it('uses idle callback with an eventual timeout', () => {
    const task = vi.fn()
    let idleHandler: ((deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) | undefined
    const cancelIdleCallback = vi.fn()
    const scheduler = {
      setTimeout: vi.fn((_handler: () => void, _timeout?: number) => 1),
      clearTimeout: vi.fn(),
      requestIdleCallback: vi.fn((
        handler: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
        _options?: { timeout: number },
      ) => {
        idleHandler = handler
        return 7
      }),
      cancelIdleCallback,
    }

    const cancel = scheduleStartupIdle(task, 900, scheduler)
    expect(scheduler.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 900 })
    idleHandler?.({ didTimeout: false, timeRemaining: () => 10 })
    expect(task).toHaveBeenCalledOnce()
    cancel()
    expect(cancelIdleCallback).toHaveBeenCalledWith(7)
  })

  it('falls back to a short timer and supports cancellation', () => {
    const task = vi.fn()
    let timerHandler: (() => void) | undefined
    const clearTimeout = vi.fn()
    const scheduler = {
      setTimeout: vi.fn((handler: () => void, _timeout?: number) => {
        timerHandler = handler
        return 3
      }),
      clearTimeout,
    }

    const cancel = scheduleStartupIdle(task, 900, scheduler)
    cancel()
    timerHandler?.()
    expect(task).not.toHaveBeenCalled()
    expect(clearTimeout).toHaveBeenCalledWith(3)
  })
})
