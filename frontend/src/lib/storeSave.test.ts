import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debouncedSave, flushPendingSaves, immediateSave, setAutoSaveDelay, setSavesSuspended } from './storeSave'

beforeEach(() => { vi.stubGlobal('window', { dispatchEvent: vi.fn() }) })

afterEach(() => {
  setSavesSuspended(['a', 'b', 'suspended-test'], false)
  setAutoSaveDelay(250)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('storeSave', () => {
  it('blocks update restart on save failure until that data is saved successfully', async () => {
    debouncedSave('update-save', async () => { throw new Error('disk full') })
    await expect(flushPendingSaves(true)).rejects.toThrow('Save failed')
    immediateSave('update-save', async () => undefined)
    await expect(flushPendingSaves(true)).resolves.toBeUndefined()
  })
  it('waits for a debounced write already in flight', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    debouncedSave('flight', () => new Promise<void>(resolve => { finish = resolve }), 250)
    await vi.advanceTimersByTimeAsync(250)
    let flushed = false
    const pending = flushPendingSaves(true).then(() => { flushed = true })
    await Promise.resolve()
    expect(flushed).toBe(false)
    finish(); await pending
    expect(flushed).toBe(true)
  })
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

describe('immediateSave', () => {
  it('starts without waiting for the autosave interval', async () => {
    setAutoSaveDelay(5000)
    const save = vi.fn().mockResolvedValue(undefined)
    immediateSave('immediate-test', save)
    expect(save).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
  })

  it('serializes successive snapshots', async () => {
    let finish!: () => void
    const first = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const second = vi.fn().mockResolvedValue(undefined)
    immediateSave('ordered-test', first)
    immediateSave('ordered-test', second)
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce())
  })

  it('reports failures and continues with the next snapshot', async () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    const next = vi.fn().mockResolvedValue(undefined)
    immediateSave('failure-test', () => Promise.reject(new Error('disk full')))
    immediateSave('failure-test', next)
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce())
    expect(dispatchEvent).toHaveBeenCalledOnce()
    expect(dispatchEvent.mock.calls[0][0].detail).toBe('disk full')
  })

  it('is dropped while another window owns the data', () => {
    setSavesSuspended(['suspended-test'], true)
    const save = vi.fn().mockResolvedValue(undefined)
    immediateSave('suspended-test', save)
    expect(save).not.toHaveBeenCalled()
  })

  it('replaces an older queued debounced save', async () => {
    vi.useFakeTimers()
    const older = vi.fn().mockResolvedValue(undefined)
    const newer = vi.fn().mockResolvedValue(undefined)
    debouncedSave('a', older, 1000)
    immediateSave('a', newer)
    await vi.advanceTimersByTimeAsync(2000)
    expect(older).not.toHaveBeenCalled()
    expect(newer).toHaveBeenCalledOnce()
  })
})
