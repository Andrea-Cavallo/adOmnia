import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoIDEWorkspaceSymbol } from '@/lib/goide-lsp-api'
import { bindingSearchText, readRecentCommands, rememberCommand, testTargetFromSymbol } from './goStudioSearchExtras'

function symbol(name: string, relativePath: string, container = ''): GoIDEWorkspaceSymbol {
  return { name, container, kind: 12, location: { uri: '', path: '', relativePath, range: { startLine: 4, startColumn: 1, endLine: 4, endColumn: 1 } } } as unknown as GoIDEWorkspaceSymbol
}

describe('goStudioSearchExtras', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  })

  it('turns test, benchmark and fuzz functions into runnable targets', () => {
    expect(testTargetFromSymbol(symbol('TestArea', 'geom/area_test.go'))).toEqual({ line: 4, kind: 'test', name: 'TestArea', packagePath: './geom' })
    expect(testTargetFromSymbol(symbol('BenchmarkSum', 'sum_test.go'))).toMatchObject({ kind: 'benchmark', packagePath: '.' })
    expect(testTargetFromSymbol(symbol('FuzzParse', 'p/parse_test.go'))).toMatchObject({ kind: 'test' })
    expect(testTargetFromSymbol(symbol('Testify', 'x_test.go'))).toBeNull()
    expect(testTargetFromSymbol(symbol('TestArea', 'geom/area.go'))).toBeNull()
    expect(testTargetFromSymbol(symbol('TestHelper', 'x_test.go', 'suite'))).toBeNull()
  })

  it('makes shortcuts searchable with spaces', () => {
    expect(bindingSearchText('Ctrl+Shift+F')).toBe('Ctrl+Shift+F Ctrl Shift F')
    expect(bindingSearchText('')).toBe('')
  })

  it('keeps the most recent commands first without duplicates', () => {
    rememberCommand('run.run')
    rememberCommand('vcs.commit')
    expect(rememberCommand('run.run')).toEqual(['run.run', 'vcs.commit'])
    expect(readRecentCommands()).toEqual(['run.run', 'vcs.commit'])
  })
})
