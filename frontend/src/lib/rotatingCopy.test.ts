import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadRotatingCopy, nextCopyIndex } from './rotatingCopy'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  })
})

afterEach(() => { vi.unstubAllGlobals() })

const PAIRS = [
  { title: 'one', subtitle: 'first' },
  { title: 'two', subtitle: 'second' },
  { title: 'three', subtitle: 'third' },
]

describe('rotating copy', () => {
  it('never repeats the previous index and stays in range', () => {
    for (const previous of PAIRS.map((_, index) => index)) {
      for (const random of [0, 0.01, 0.5, 0.99, 0.999, 7.2]) {
        const next = nextCopyIndex(PAIRS.length, random, previous)
        expect(next).toBeGreaterThanOrEqual(0)
        expect(next).toBeLessThan(PAIRS.length)
        expect(next).not.toBe(previous)
      }
    }
  })

  it('handles a single pair and an empty random range', () => {
    expect(nextCopyIndex(1, 0.42, 0)).toBe(0)
    expect(nextCopyIndex(0, 0.42, null)).toBe(0)
  })

  it('remembers the choice per key, so consecutive visits differ', () => {
    const first = loadRotatingCopy('test.copy', PAIRS, 0)
    expect(first).toEqual(PAIRS[0])
    expect(store.get('test.copy')).toBe('0')
    const second = loadRotatingCopy('test.copy', PAIRS, 0)
    expect(second).toEqual(PAIRS[1])
    expect(store.get('test.copy')).toBe('1')
    expect(loadRotatingCopy('other.copy', PAIRS, 0)).toEqual(PAIRS[0])
  })

  it('keeps working when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadRotatingCopy('test.copy', PAIRS, 0)).toEqual(PAIRS[0])
  })
})
