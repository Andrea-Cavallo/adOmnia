import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/code-studio-lsp-api', () => ({ requestProjectSearch: vi.fn() }))
vi.mock('@/lib/code-studio-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))

import type { GoIDESearchMatch } from '@/lib/code-studio-lsp-api'
import { limitMatches } from './CodeStudioFindInFiles'

const matches = (file: string, count: number) => Array.from({ length: count }, (_, index) => ({ relativePath: file, line: index + 1 } as GoIDESearchMatch))

describe('limitMatches', () => {
  it('keeps file grouping and stops at the limit', () => {
    const visible = limitMatches([['a.go', matches('a.go', 3)], ['b.go', matches('b.go', 5)], ['c.go', matches('c.go', 2)]], 6)
    expect(visible.map(([file, items]) => `${file}:${items.length}`)).toEqual(['a.go:3', 'b.go:3'])
  })
})
