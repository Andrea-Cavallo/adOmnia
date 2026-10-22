import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/monacoSetup', () => ({ monaco: {} }))
vi.mock('@/lib/code-studio-lsp-api', () => ({ requestImplementationMarkers: vi.fn() }))
vi.mock('@/stores/codeStudio', () => ({}))
vi.mock('@/stores/codeStudioLsp', () => ({ useCodeStudioLspStore: Object.assign(vi.fn(), { setState: vi.fn(), getState: vi.fn(), subscribe: vi.fn() }) }))
vi.mock('./codeStudioLanguageFeatures', () => ({ documentForModel: vi.fn(), navigateToLocation: vi.fn() }))
vi.mock('./codeStudioSymbols', () => ({ symbolPathAt: vi.fn() }))
vi.mock('./codeStudioLspSync', () => ({ flushCodeStudioDocument: vi.fn() }))

const { describeImplementationMarker, implementationDecorations } = await import('./codeStudioImplementationMarkers')

const location = { uri: 'file:///p/A.java', path: 'C:/p/A.java', relativePath: 'A.java', external: false, range: {} }

function marker(overrides: Record<string, unknown> = {}) {
  return { line: 3, column: 5, name: 'area()', direction: 'implementedBy', locations: [location, location], ...overrides } as never
}

describe('implementation markers', () => {
  it('describes implementations without pretending they are always types', () => {
    expect(describeImplementationMarker(marker())).toBe('area() has 2 implementations · click to navigate')
    expect(describeImplementationMarker(marker({ name: 'Shape', locations: [location] }))).toBe('Shape has 1 implementation · click to navigate')
    expect(describeImplementationMarker(marker({ name: 'Circle', direction: 'implements', locations: [location] }))).toBe('Circle implements 1 interface · click to navigate')
  })

  it('puts the arrow down for implementedBy and up for implements', () => {
    const down = implementationDecorations([marker()])[0]
    const up = implementationDecorations([marker({ direction: 'implements' })])[0]
    expect(down.range).toEqual({ startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1 })
    expect(down.options.glyphMarginClassName).toContain('code-studio-impl-down')
    expect(up.options.glyphMarginClassName).toContain('code-studio-impl-up')
  })
})
