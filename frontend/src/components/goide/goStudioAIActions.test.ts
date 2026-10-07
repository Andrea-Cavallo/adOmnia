import { describe, expect, it } from 'vitest'
import { GO_STUDIO_AI_ACTIONS, buildAIActionPrompt, enclosingTopLevelBlock, unifiedDiff, type GoStudioAIContext } from './goStudioAIActions'

const SOURCE = [
  'package demo',
  '',
  'func Add(a, b int) int {',
  '\tif a < 0 {',
  '\t\treturn b',
  '\t}',
  '\treturn a + b',
  '}',
  '',
  'type Point struct{ X, Y int }',
]

describe('enclosingTopLevelBlock', () => {
  it('finds the function around the cursor', () => {
    expect(enclosingTopLevelBlock(SOURCE, 5)).toEqual({ startLine: 3, endLine: 8 })
    expect(enclosingTopLevelBlock(SOURCE, 3)).toEqual({ startLine: 3, endLine: 8 })
  })

  it('handles one-line declarations and the space between blocks', () => {
    expect(enclosingTopLevelBlock(SOURCE, 10)).toEqual({ startLine: 10, endLine: 10 })
    expect(enclosingTopLevelBlock(SOURCE, 9)).toBeNull()
    expect(enclosingTopLevelBlock(SOURCE, 1)).toBeNull()
  })
})

describe('unifiedDiff', () => {
  it('shows removed and added lines with context', () => {
    const diff = unifiedDiff('a\nb\nc\nd\n', 'a\nB\nc\nd\n', 1)
    expect(diff).toBe('@@ line 2 @@\n a\n-b\n+B\n c')
  })

  it('is empty when nothing changed', () => {
    expect(unifiedDiff('a\nb\n', 'a\nb\n')).toBe('')
  })
})

describe('buildAIActionPrompt', () => {
  const action = GO_STUDIO_AI_ACTIONS.find((item) => item.id === 'generate-tests')!
  const base: GoStudioAIContext = {
    relativePath: 'demo/add.go',
    focus: { startLine: 3, endLine: 8, code: SOURCE.slice(2, 8).join('\n'), kind: 'function' },
    problems: [],
    references: [],
    failingTests: [],
  }

  it('includes only the context that exists', () => {
    const prompt = buildAIActionPrompt(action, base)
    expect(prompt).toContain(action.instruction)
    expect(prompt).toContain('enclosing declaration, demo/add.go, lines 3-8')
    expect(prompt).not.toContain('Failing tests')
    expect(prompt).not.toContain('git diff')
    expect(prompt).not.toContain('Test coverage of this file')
  })

  it('adds problems, references, diff, failing tests and coverage', () => {
    const prompt = buildAIActionPrompt(action, {
      ...base,
      symbol: 'Add',
      problems: [{ line: 4, message: 'unused variable', source: 'staticcheck' }],
      references: ['demo/main.go:12 Add(1, 2)'],
      diff: '@@ line 4 @@\n+\tif a < 0 {',
      failingTests: [{ name: 'demo.TestAdd', output: 'want 3, got 2' }],
      coverage: { percent: 62.5, uncovered: ['Add (50%)'] },
    })
    expect(prompt).toContain('- line 4: unused variable (staticcheck)')
    expect(prompt).toContain('References to Add (gopls):\n- demo/main.go:12 Add(1, 2)')
    expect(prompt).toContain('```diff')
    expect(prompt).toContain('- demo.TestAdd')
    expect(prompt).toContain('62.5%')
    expect(prompt).toContain('Add (50%)')
  })

  it('stays under the chat limit', () => {
    const huge = { ...base, focus: { ...base.focus, code: 'x'.repeat(200_000) }, diff: 'y'.repeat(200_000) }
    expect(buildAIActionPrompt(action, huge).length).toBeLessThanOrEqual(56 * 1024)
  })
})
