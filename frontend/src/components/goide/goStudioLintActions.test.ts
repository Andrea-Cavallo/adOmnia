import { describe, expect, it } from 'vitest'
import type { GoIDEDiagnostic } from '@/lib/goide-lsp-api'
import { lintActionsFor } from './goStudioLintActions'

const lines = ['package main', '', 'func main() {', '\ts := fmt.Sprintf("hello") //nolint:errcheck', '\tos.Open("x")', '}']
const text = (line: number) => lines[line - 1] ?? ''
const at = (line: number, extra: Partial<GoIDEDiagnostic>): GoIDEDiagnostic => ({
  range: { startLine: line, startColumn: 2, endLine: line, endColumn: 3 }, severity: 2, message: 'x', ...extra,
})

describe('lintActionsFor', () => {
  it('offers the linter fix first, then a suppression directive', () => {
    const edits = [{ range: { startLine: 5, startColumn: 2, endLine: 5, endColumn: 14 }, text: '_, _ = os.Open("x")' }]
    const actions = lintActionsFor([at(5, { source: 'golangci-lint · errcheck', suppression: '//nolint:errcheck', fixes: [{ title: 'Check error', edits }] })], 5, 5, text, true)
    expect(actions.map((action) => action.title)).toEqual(['Check error (errcheck)', 'Suppress errcheck for this line'])
    expect(actions[1].edits[0]).toEqual({ range: { startLine: 5, startColumn: 14, endLine: 5, endColumn: 14 }, text: ' //nolint:errcheck' })
  })

  it('puts staticcheck directives above the line with the same indentation', () => {
    const [action] = lintActionsFor([at(5, { source: 'staticcheck', suppression: '//lint:ignore SA1019 reason' })], 1, 9, text, true)
    expect(action.edits[0]).toEqual({ range: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 1 }, text: '\t//lint:ignore SA1019 reason\n' })
  })

  it('does not stack nolint comments and never applies stale offsets to a modified buffer', () => {
    expect(lintActionsFor([at(4, { source: 'golangci-lint · staticcheck', suppression: '//nolint:staticcheck' })], 4, 4, text, true)).toEqual([])
    const stale = lintActionsFor([at(5, { source: 'golangci-lint · errcheck', suppression: '//nolint:errcheck', fixes: [{ title: 'Fix', edits: [] }] })], 5, 5, text, false)
    expect(stale).toEqual([])
  })
})
