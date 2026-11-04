import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOutputBatcher } from './outputBatcher'

describe('createOutputBatcher', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('delivers the first item at once and groups the rest per interval', () => {
    const delivered: number[][] = []
    const batcher = createOutputBatcher<number>((items) => delivered.push(items), 100)
    batcher.add(1)
    expect(delivered).toEqual([[1]])
    batcher.add(2)
    batcher.add(3)
    expect(delivered).toEqual([[1]])
    vi.advanceTimersByTime(100)
    expect(delivered).toEqual([[1], [2, 3]])
  })

  it('flush keeps the order with an event that must follow the output', () => {
    const delivered: number[][] = []
    const batcher = createOutputBatcher<number>((items) => delivered.push(items), 100)
    batcher.add(1)
    batcher.add(2)
    batcher.flush()
    expect(delivered).toEqual([[1], [2]])
    vi.advanceTimersByTime(500)
    expect(delivered).toEqual([[1], [2]])
  })
})
