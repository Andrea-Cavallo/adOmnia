import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/monacoSetup', () => ({ monaco: {} }))
vi.mock('@/lib/goide-lsp-api', () => ({}))
vi.mock('./goStudioLanguageFeatures', () => ({ prepareDocument: vi.fn() }))
vi.mock('./goStudioWorkspaceEdits', () => ({ applyGoStudioWorkspaceChange: vi.fn() }))

import type { GoIDESymbolNode, GoIDEWorkspaceSymbol } from '@/lib/goide-lsp-api'
import { implementableInterfaces, interfaceAssertion, interfaceReference, structAtLine } from './goStudioImplementInterface'

const symbol = (name: string, container: string, relativePath: string | undefined, kind = 11): GoIDEWorkspaceSymbol => ({
  name, kind, container,
  location: { uri: 'file:///x', path: '/x', relativePath, external: !relativePath, range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } },
} as GoIDEWorkspaceSymbol)

describe('implement interface helpers', () => {
  it('finds the struct around the caret, also inside nested declarations', () => {
    const range = (startLine: number, endLine: number) => ({ startLine, startColumn: 1, endLine, endColumn: 1 })
    const symbols = [
      { name: 'main', kind: 12, range: range(1, 3), selectionRange: range(1, 1), children: [] },
      { name: 'Buffer', kind: 23, range: range(5, 8), selectionRange: range(5, 5), children: [{ name: 'data', kind: 8, range: range(6, 6), selectionRange: range(6, 6), children: [] }] },
    ] as unknown as GoIDESymbolNode[]
    expect(structAtLine(symbols, 6)?.name).toBe('Buffer')
    expect(structAtLine(symbols, 2)).toBeNull()
  })

  it('keeps exported interfaces from other packages and any interface from the same package', () => {
    const results = implementableInterfaces([
      symbol('ReadWriter', 'io', undefined),
      symbol('ReadWriter.Reader', 'io', undefined),
      symbol('handler', 'example.com/app/api', 'api/types.go'),
      symbol('store', 'example.com/app/db', 'db/db.go'),
      symbol('Close', 'io', undefined, 6),
    ], 'api')
    expect(results.map((item) => item.name)).toEqual(['ReadWriter', 'handler'])
  })

  it('qualifies external interfaces and writes the idiomatic assertion', () => {
    expect(interfaceReference(symbol('Handler', 'net/http', undefined), 'api')).toBe('http.Handler')
    expect(interfaceReference(symbol('Store', 'example.com/app/api', 'api/store.go'), 'api')).toBe('Store')
    expect(interfaceAssertion('Buffer', 'io.ReadWriter')).toBe('var _ io.ReadWriter = (*Buffer)(nil)')
  })
})
