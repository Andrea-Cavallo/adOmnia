import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/goide-lsp-api', () => ({ requestDocumentSymbols: vi.fn(), updateDocumentBuffer: vi.fn(), openExternalDocument: vi.fn() }))
vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))

import { symbolPathAt } from './goStudioSymbols'

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
