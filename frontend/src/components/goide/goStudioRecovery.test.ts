import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ remember: vi.fn(() => Promise.resolve()), forget: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/goide-api', () => ({ rememberGoIDEBuffer: mocks.remember, forgetGoIDEBuffer: mocks.forget }))

import { cancelBufferRecovery, flushBufferRecovery, scheduleBufferRecovery } from './goStudioRecovery'

afterEach(() => { vi.useRealTimers(); mocks.remember.mockClear(); mocks.forget.mockClear() })

describe('goStudioRecovery', () => {
  it('debounces typing into one write with the latest content', () => {
    vi.useFakeTimers()
    scheduleBufferRecovery('s', 'main.go', 'a', 'tok')
    scheduleBufferRecovery('s', 'main.go', 'ab', 'tok')
    vi.advanceTimersByTime(2000)
    expect(mocks.remember).toHaveBeenCalledTimes(1)
    expect(mocks.remember).toHaveBeenCalledWith('s', 'main.go', 'ab', 'tok')
  })

  it('flush writes pending buffers immediately, exactly once', () => {
    vi.useFakeTimers()
    scheduleBufferRecovery('s', 'a.go', 'one', 't')
    scheduleBufferRecovery('s', 'b.go', 'two', 't')
    flushBufferRecovery()
    expect(mocks.remember).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(5000)
    expect(mocks.remember).toHaveBeenCalledTimes(2)
  })

  it('cancel drops the pending write and forgets the stored copy', () => {
    vi.useFakeTimers()
    scheduleBufferRecovery('s', 'c.go', 'x', 't')
    cancelBufferRecovery('s', 'c.go')
    vi.advanceTimersByTime(5000)
    expect(mocks.remember).not.toHaveBeenCalled()
    expect(mocks.forget).toHaveBeenCalledWith('s', 'c.go')
  })
})
