import { describe, expect, it } from 'vitest'
import { indentRainbowEnabled, indentRainbowRanges } from './codeStudioIndentRainbow'

describe('indent rainbow', () => {
  it('colors one block per indentation level', () => {
    const text = 'def f():\n    if x:\n        y()\n\n    return\n'
    expect(indentRainbowRanges(text, 4)).toEqual([
      { line: 2, startColumn: 1, endColumn: 5, level: 0 },
      { line: 3, startColumn: 1, endColumn: 5, level: 0 },
      { line: 3, startColumn: 5, endColumn: 9, level: 1 },
      { line: 5, startColumn: 1, endColumn: 5, level: 0 },
    ])
  })

  it('handles yaml two-space indent and tabs', () => {
    expect(indentRainbowRanges('a:\n  b:\n    c: 1', 2).map((r) => r.level)).toEqual([0, 0, 1])
    expect(indentRainbowRanges('\t\tx', 4)).toEqual([
      { line: 1, startColumn: 1, endColumn: 2, level: 0 },
      { line: 1, startColumn: 2, endColumn: 3, level: 1 },
    ])
  })

  it('only applies to python and yaml', () => {
    expect(['a.py', 'ci.yml', 'k8s.yaml', 'main.go'].map((p) => indentRainbowEnabled(p))).toEqual([true, true, true, false])
  })
})
