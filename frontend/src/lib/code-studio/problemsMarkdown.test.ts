import { describe, expect, it } from 'vitest'
import type { GoIDEDiagnosticsReport } from '@/lib/code-studio-lsp-api'
import { problemsToMarkdown } from './problemsMarkdown'

const report = (relativePath: string, diagnostics: Array<{ severity: number; message: string; source?: string; line: number }>) => ({
  uri: `file:///${relativePath}`, path: relativePath, relativePath,
  diagnostics: diagnostics.map((item) => ({ severity: item.severity, message: item.message, source: item.source ?? '', range: { startLine: item.line, startColumn: 4, endLine: item.line, endColumn: 9 } })),
}) as unknown as GoIDEDiagnosticsReport

describe('problemsToMarkdown', () => {
  it('lists problems per file as checkboxes, errors first', () => {
    const markdown = problemsToMarkdown([report('app.go', [
      { severity: 2, message: 'unused parameter: ctx', source: 'unusedparams', line: 391 },
      { severity: 1, message: 'bad\nthing', source: 'compiler', line: 500 },
    ])], [{ path: 'main.go', line: 3, column: 1, text: 'undefined: x' }])
    expect(markdown).toContain('# Problems')
    expect(markdown).toContain('3 problems in 1 file')
    expect(markdown).toContain('## app.go')
    expect(markdown.indexOf('compiler')).toBeLessThan(markdown.indexOf('unusedparams'))
    expect(markdown).toContain('- [ ] **error · compiler** 500:4 — bad thing')
    expect(markdown).toContain('- [ ] main.go:3:1 — undefined: x')
  })

  it('skips files without problems', () => {
    expect(problemsToMarkdown([report('clean.go', [])])).toContain('0 problems')
  })
})
