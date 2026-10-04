import { afterEach, describe, expect, it, vi } from 'vitest'
import { debouncedSave, flushPendingSaves, setSavesSuspended } from './storeSave'

vi.stubGlobal('window', { dispatchEvent: vi.fn() })

afterEach(() => { setSavesSuspended(['a', 'b'], false); vi.useRealTimers() })

describe('storeSave', () => {
  it('flushes queued saves immediately, once', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    debouncedSave('a', save, 10_000)
    await flushPendingSaves()
    expect(save).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('drops saves while another window owns the data, and the queued one too', async () => {
    vi.useFakeTimers()
    const queued = vi.fn(async () => undefined)
    debouncedSave('b', queued, 1000)
    setSavesSuspended(['b'], true)
    const later = vi.fn(async () => undefined)
    debouncedSave('b', later, 1000)
    await vi.advanceTimersByTimeAsync(5000)
    await flushPendingSaves()
    expect(queued).not.toHaveBeenCalled()
    expect(later).not.toHaveBeenCalled()
    setSavesSuspended(['b'], false)
    debouncedSave('b', later, 1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(later).toHaveBeenCalledTimes(1)
  })
})
