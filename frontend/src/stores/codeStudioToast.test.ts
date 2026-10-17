import { afterEach, describe, expect, it, vi } from 'vitest'
import { studioToast, useStudioToastStore } from './codeStudioToast'

describe('studio toast', () => {
  afterEach(() => { vi.useRealTimers(); useStudioToastStore.setState({ toasts: [] }) })

  it('keeps the last three toasts and auto-dismisses them', () => {
    vi.useFakeTimers()
    for (const m of ['a', 'b', 'c', 'd']) studioToast(m)
    expect(useStudioToastStore.getState().toasts.map((t) => t.message)).toEqual(['b', 'c', 'd'])
    vi.advanceTimersByTime(4000)
    expect(useStudioToastStore.getState().toasts).toEqual([])
  })
})
