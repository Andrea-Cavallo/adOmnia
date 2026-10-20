import { describe, expect, it, vi } from 'vitest'
import { settleResourceStops } from './resourceStops'

describe('resource shutdown', () => {
  it('continues after synchronous and asynchronous failures and identifies each failed service', async () => {
    const stop = vi.fn(async () => undefined)
    const failures = await settleResourceStops([
      { label: 'AI', stop: () => { throw new Error('offline') } },
      { label: 'gopls', stop: async () => { throw new Error('timeout') } },
      { label: 'run', stop },
    ])
    expect(stop).toHaveBeenCalledOnce()
    expect(failures).toEqual(['AI: Error: offline', 'gopls: Error: timeout'])
  })
  it('waits for the last process before reporting success', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    let finished = false
    const result = settleResourceStops([{ label: 'AI', stop: () => pending }]).then(value => { finished = true; return value })
    await Promise.resolve()
    expect(finished).toBe(false)
    release()
    expect(await result).toEqual([])
  })
})
