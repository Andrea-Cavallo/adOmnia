import { afterEach, describe, expect, it, vi } from 'vitest'
import { immediateSave, setAutoSaveDelay } from './storeSave'

afterEach(() => {
  vi.unstubAllGlobals()
  setAutoSaveDelay(250)
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
})
