import { describe, expect, it, vi } from 'vitest'
import type { GoIDESymbolNode } from '@/lib/code-studio-lsp-api'
vi.mock('@/lib/monacoSetup', () => ({ monaco: {} }))
vi.mock('./codeStudioLanguageFeatures', () => ({ prepareDocument: vi.fn() }))
const { originDeclarationLine } = await import('./codeStudioCodeVision')
const symbol = (kind: number, line: number, children: GoIDESymbolNode[] = []) => ({ kind, selectionRange: { startLine: line }, children }) as GoIDESymbolNode

describe('one symbol origin per file', () => {
  it('anchors Go package context to the first type, excluding constants, methods and later types', () => {
    expect(originDeclarationLine([symbol(14, 17), symbol(14, 19), symbol(11, 23, [symbol(6, 24), symbol(6, 25)]), symbol(23, 29)])).toBe(23)
  })
  it('anchors a Java class before its nested members', () => {
    expect(originDeclarationLine([symbol(5, 5, [symbol(6, 9), symbol(5, 20)])])).toBe(5)
  })
  it('uses a single top-level declaration in function-only files and sorts source positions', () => {
    expect(originDeclarationLine([symbol(12, 20), symbol(12, 4)])).toBe(4)
    expect(originDeclarationLine([])).toBeUndefined()
  })
})
