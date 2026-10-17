import { describe, expect, it, vi } from 'vitest'
import { RequestEpoch, cancelInFlight } from './codeStudioStaleRequest'

describe('RequestEpoch', () => {
  it('marks only the latest request as current', () => {
    const epoch = new RequestEpoch()
    const first = epoch.begin()
    expect(epoch.isCurrent(first)).toBe(true)
    const second = epoch.begin()
    expect(epoch.isCurrent(first)).toBe(false)
    expect(epoch.isCurrent(second)).toBe(true)
  })

  it('invalidates every in-flight request on session change or unmount', () => {
    const epoch = new RequestEpoch()
    const token = epoch.begin()
    epoch.invalidate()
    expect(epoch.isCurrent(token)).toBe(false)
  })
})

describe('cancelInFlight', () => {
  it('cancels once and forgets, safe to repeat', () => {
    const cancel = vi.fn()
    const ref = { current: { cancel } }
    cancelInFlight(ref)
    cancelInFlight(ref)
    expect(cancel).toHaveBeenCalledOnce()
    expect(ref.current).toBeNull()
  })

  it('never throws when nothing is running or cancel fails', () => {
    expect(() => cancelInFlight({ current: null })).not.toThrow()
    expect(() => cancelInFlight({ current: { cancel: () => { throw new Error('boom') } } })).not.toThrow()
  })
})
