import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('@/lib/goide-lsp-api', () => ({}))

import { recordNavigation, stepNavigation, toggleBookmarkIn } from '@/stores/goideNavigation'

const at = (relativePath: string, line: number, column = 1) => ({ relativePath, line, column })

describe('Go Studio navigation history', () => {
  it('merges small moves in the same file and records real jumps', () => {
    let history = recordNavigation({ entries: [], index: -1 }, at('main.go', 10))
    history = recordNavigation(history, at('main.go', 14))
    expect(history.entries).toEqual([at('main.go', 14)])
    history = recordNavigation(history, at('main.go', 80))
    history = recordNavigation(history, at('geo/geo.go', 3))
    expect(history.entries.map((entry) => entry.relativePath)).toEqual(['main.go', 'main.go', 'geo/geo.go'])
    expect(history.index).toBe(2)
  })

  it('goes back and forward, and a new jump drops the forward entries', () => {
    let history = { entries: [at('a.go', 1), at('b.go', 1), at('c.go', 1)], index: 2 }
    const back = stepNavigation(history, -1)!
    expect(back.target.relativePath).toBe('b.go')
    history = back.history
    expect(stepNavigation(history, 1)?.target.relativePath).toBe('c.go')
    history = recordNavigation(history, at('d.go', 1))
    expect(history.entries.map((entry) => entry.relativePath)).toEqual(['a.go', 'b.go', 'd.go'])
    expect(stepNavigation(history, 1)).toBeNull()
  })

  it('toggles bookmarks keeping them sorted by file and line', () => {
    let bookmarks = toggleBookmarkIn([], { relativePath: 'main.go', line: 20 })
    bookmarks = toggleBookmarkIn(bookmarks, { relativePath: 'a.go', line: 5 })
    bookmarks = toggleBookmarkIn(bookmarks, { relativePath: 'main.go', line: 3 })
    expect(bookmarks.map((item) => `${item.relativePath}:${item.line}`)).toEqual(['a.go:5', 'main.go:3', 'main.go:20'])
    expect(toggleBookmarkIn(bookmarks, { relativePath: 'main.go', line: 3 })).toHaveLength(2)
  })
})
