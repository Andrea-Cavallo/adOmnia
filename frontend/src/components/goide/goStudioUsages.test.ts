import { describe, expect, it } from 'vitest'
import type { GoIDEEditorLocation } from '@/lib/goide-lsp-api'
import { groupUsagesByKind, hasUsageKinds } from './goStudioUsages'

const at = (relativePath: string, line: number, usage?: string): GoIDEEditorLocation => ({
  uri: `file:///p/${relativePath}`, path: `/p/${relativePath}`, relativePath, external: false,
  range: { startLine: line, startColumn: 1, endLine: line, endColumn: 2 }, preview: '', usage,
} as GoIDEEditorLocation)

describe('groupUsagesByKind', () => {
  it('orders declaration, writes, reads and imports, each grouped by file', () => {
    const groups = groupUsagesByKind([at('a.go', 9, 'read'), at('a.go', 3, 'declaration'), at('b.go', 4, 'write'), at('a.go', 10, 'read'), at('c.go', 1, 'import')])
    expect(groups.map((group) => `${group.kind}:${group.count}`)).toEqual(['declaration:1', 'write:1', 'read:2', 'import:1'])
    expect(groups[2].files).toEqual([['a.go', [expect.objectContaining({ range: expect.objectContaining({ startLine: 9 }) }), expect.anything()]]])
  })

  it('keeps unclassified results in a single usages section', () => {
    const locations = [at('x.go', 1), at('y.go', 2)]
    expect(hasUsageKinds(locations)).toBe(false)
    expect(groupUsagesByKind(locations).map((group) => group.kind)).toEqual(['other'])
  })
})
