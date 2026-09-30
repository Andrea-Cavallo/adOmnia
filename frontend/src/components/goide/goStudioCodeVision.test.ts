import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/monacoSetup', () => ({ monaco: {} }))
vi.mock('./goStudioLanguageFeatures', () => ({ prepareDocument: vi.fn() }))

const { authorForRange } = await import('./goStudioCodeVision')

const line = (n: number, author: string, date: string, hash = 'abc1234') => ({ line: n, hash, author, date })
const UNCOMMITTED = '0000000000000000000000000000000000000000'

describe('authorForRange', () => {
  it('returns the author of the latest committed change in the range', () => {
    const blame = [line(1, 'Ada', '2026-01-01'), line(2, 'Linus', '2026-03-01'), line(3, 'Ada', '2026-02-01'), line(9, 'Rob', '2026-09-01')]
    expect(authorForRange(blame, 1, 3)).toBe('Linus')
  })

  it('marks uncommitted edits with a star, like IntelliJ', () => {
    expect(authorForRange([line(1, 'Ada', '2026-01-01'), line(2, 'Not Committed Yet', '2026-09-30', UNCOMMITTED)], 1, 2)).toBe('Ada *')
    expect(authorForRange([line(1, 'Not Committed Yet', '2026-09-30', UNCOMMITTED)], 1, 1)).toBe('new *')
  })

  it('returns nothing without blame data', () => {
    expect(authorForRange([], 1, 10)).toBe('')
  })
})
