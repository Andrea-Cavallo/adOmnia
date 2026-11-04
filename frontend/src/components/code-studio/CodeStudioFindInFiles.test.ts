import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/code-studio-lsp-api', () => ({ requestProjectSearch: vi.fn(), startProjectSearch: vi.fn(), cancelProjectSearch: vi.fn() }))
vi.mock('@/lib/code-studio-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))

import type { GoIDESearchMatch } from '@/lib/code-studio-lsp-api'
import { limitMatches, visibleRange } from './CodeStudioFindInFiles'

const matches = (file: string, count: number) => Array.from({ length: count }, (_, index) => ({ relativePath: file, line: index + 1 } as GoIDESearchMatch))

describe('limitMatches', () => {
  it('keeps file grouping and stops at the limit', () => {
    const visible = limitMatches([['a.go', matches('a.go', 3)], ['b.go', matches('b.go', 5)], ['c.go', matches('c.go', 2)]], 6)
    expect(visible.map(([file, items]) => `${file}:${items.length}`)).toEqual(['a.go:3', 'b.go:3'])
  })
})

describe('visibleRange', () => {
  it('draws only the rows in the viewport plus overscan', () => {
    // 20 rows of 22px, viewport 220px (10 rows), scroll 0: 10 visible + 8 overscan at the end.
    expect(visibleRange(1000, 0, 220, 22, 8)).toEqual({ start: 0, end: 18 })
    // Scrolled to row 500: 8 before, 10 visible, 8 after.
    expect(visibleRange(1000, 500 * 22, 220, 22, 8)).toEqual({ start: 492, end: 518 })
    // Never past the end, never negative.
    expect(visibleRange(5, 0, 220, 22, 8)).toEqual({ start: 0, end: 5 })
    expect(visibleRange(0, 999, 220, 22, 8)).toEqual({ start: 0, end: 0 })
  })
})
