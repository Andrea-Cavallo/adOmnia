import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/goide-lsp-api', () => ({ requestDocumentSymbols: vi.fn(), updateDocumentBuffer: vi.fn(), openExternalDocument: vi.fn() }))
vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))

import { groupStructure, splitSignature, symbolPathAt } from './goStudioSymbols'

const range = (startLine: number, endLine: number) => ({ startLine, startColumn: 1, endLine, endColumn: 2 })
const symbols = [
  { name: 'Server', kind: 23, range: range(3, 10), selectionRange: range(3, 3), children: [{ name: 'addr', kind: 8, range: range(4, 4), selectionRange: range(4, 4) }] },
  { name: '(*Server).Serve', kind: 6, range: range(12, 20), selectionRange: range(12, 12) },
]

describe('symbolPathAt', () => {
  it('returns the chain of symbols containing the cursor', () => {
    expect(symbolPathAt(symbols, 4, 1).map((node) => node.name)).toEqual(['Server', 'addr'])
    expect(symbolPathAt(symbols, 15, 3).map((node) => node.name)).toEqual(['(*Server).Serve'])
    expect(symbolPathAt(symbols, 11, 1)).toEqual([])
  })
})

describe('groupStructure', () => {
  const node = (name: string, kind: number, line: number, children?: unknown[]) => ({ name, kind, range: range(line, line), selectionRange: range(line, line), ...(children ? { children } : {}) })

  it('groups top-level symbols by section in GoLand order', () => {
    const sections = groupStructure([node('NewLogger', 12, 9), node('LOGFILE', 14, 1), node('Logger', 23, 4), node('level', 13, 2)] as never)
    expect(sections.map((section) => [section.id, section.nodes.map((item) => item.name)])).toEqual([
      ['constants', ['LOGFILE']], ['variables', ['level']], ['types', ['Logger']], ['functions', ['NewLogger']],
    ])
  })

  it('nests methods under their receiver type after the fields', () => {
    const [types] = groupStructure([node('Logger', 23, 4, [node('file', 8, 5)]), node('(*Logger).Debug', 6, 12), node('(Remote).Ping', 6, 20)] as never)
    expect(types.nodes[0].children?.map((child) => child.name)).toEqual(['file', 'Debug'])
    const sections = groupStructure([node('Logger', 23, 4), node('(Remote).Ping', 6, 20)] as never)
    expect(sections.find((section) => section.id === 'methods')?.nodes.map((item) => item.name)).toEqual(['(Remote).Ping'])
  })
})

describe('splitSignature', () => {
  it('splits parameters and results', () => {
    expect(splitSignature('func(v ...any)')).toEqual({ params: '(v ...any)', result: '' })
    expect(splitSignature('func() *Logger')).toEqual({ params: '()', result: '*Logger' })
    expect(splitSignature('func(f func(int) bool) (int, error)')).toEqual({ params: '(f func(int) bool)', result: '(int, error)' })
    expect(splitSignature('func[T any](x T) T')).toEqual({ params: '(x T)', result: 'T' })
  })

  it('returns null for non-signatures', () => {
    expect(splitSignature('struct{...}')).toBeNull()
  })
})
