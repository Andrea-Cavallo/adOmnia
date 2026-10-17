import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/monacoSetup', () => ({ monaco: {
  Range: class { constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {} },
  MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
  editor: { InjectedTextCursorStops: { None: 3 }, TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 } },
} }))
import { inlineDiagnosticDecorations } from './goStudioInlineDiagnostics'
import type { monaco } from '@/lib/monacoSetup'

const model = { getLineCount: () => 3, getLineMaxColumn: () => 12 } as unknown as monaco.editor.ITextModel
const marker = (severity: number, message: string, line = 1) => ({ severity, message, startLineNumber: line, startColumn: 1, source: 'linter' }) as monaco.editor.IMarker

describe('inline diagnostics', () => {
  it('groups providers on a line, prioritizes errors and preserves all hover details', () => {
    const result = inlineDiagnosticDecorations(model, [marker(4, 'Warning'), marker(8, 'Broken\ncode')], [8, 4, 2])
    expect(result).toHaveLength(1)
    expect(result[0].range.startColumn).toBe(12)
    expect(result[0].options.after?.content).toBe('  Broken code (+1)')
    expect(result[0].options.className).toBe('go-studio-diagnostic-line-error')
    expect(result[0].options.hoverMessage).toHaveLength(2)
  })
  it('filters severities independently, ignores hints and invalid lines, clears empty diagnostics', () => {
    const markers = [marker(8, 'Error'), marker(4, 'Warning', 2), marker(2, 'Info', 3), marker(1, 'Hint'), marker(8, 'Stale', 4)]
    expect(inlineDiagnosticDecorations(model, markers, [8, 2]).map(d => d.range.startLineNumber)).toEqual([1, 3])
    expect(inlineDiagnosticDecorations(model, [], [8])).toEqual([])
  })
  it('bounds inline text while retaining the full diagnostic in the hover', () => {
    const result = inlineDiagnosticDecorations(model, [marker(8, 'x'.repeat(400))], [8])[0]
    expect(result.options.after?.content.length).toBe(180)
    expect(result.options.hoverMessage).toEqual([expect.objectContaining({ value: `linter: ${'x'.repeat(400)}`, isTrusted: false, supportHtml: false })])
  })
})

