import { describe, expect, it } from 'vitest'
import { windowedRange } from './useWindowedRows'

describe('windowedRange', () => {
  it('renders the first screen plus the overscan and pads the rest', () => {
    const range = windowedRange(5000, 40, 0, 400, 12)
    expect(range.start).toBe(0)
    expect(range.end).toBe(34) // ceil(400/40) + 2 × overscan
    expect(range.paddingTop).toBe(0)
    expect(range.paddingBottom).toBe((5000 - 34) * 40)
  })

  it('follows the scroll position and keeps the overscan above', () => {
    const range = windowedRange(5000, 40, 4000, 400, 12)
    expect(range.start).toBe(88) // riga 100 meno l'overscan
    expect(range.paddingTop).toBe(88 * 40)
    expect(range.end - range.start).toBe(34)
  })

  it('never runs past the last row', () => {
    const range = windowedRange(30, 40, 100000, 400, 12)
    expect(range.start).toBe(29)
    expect(range.end).toBe(30)
    expect(range.paddingBottom).toBe(0)
  })

  it('handles an empty result set', () => {
    expect(windowedRange(0, 40, 0, 400)).toMatchObject({ start: 0, end: 0, paddingTop: 0, paddingBottom: 0 })
  })

  it('falls back to a reasonable viewport before the container is measured', () => {
    expect(windowedRange(100, 40, 0, 0, 12).end).toBe(39) // 600px presunti: 15 righe + overscan
  })
})
