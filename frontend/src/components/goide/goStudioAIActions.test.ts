import { describe, expect, it } from 'vitest'
import { GO_STUDIO_AI_ACTIONS, architectureBrief, buildAIActionPrompt, enclosingTopLevelBlock, unifiedDiff, type GoStudioAIContext } from './goStudioAIActions'

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

describe('architectureBrief', () => {
  const site = { relativePath: 'api/handler.go', line: 12, column: 1 }
  const report = {
    packages: [{ path: 'demo/api', name: 'api', files: 2, site, external: ['github.com/go-chi/chi/v5'], std: 3 }],
    imports: [{ from: 'demo/api', to: 'demo/store', count: 1 }],
    modules: [{ path: 'demo', requires: [], external: ['github.com/go-chi/chi/v5'], site }],
    entries: [
      { kind: 'http', name: 'POST /orders', package: 'demo/api', site, request: { type: 'object', ref: 'Order' }, response: { type: 'object', ref: 'Order' } },
      { kind: 'kafka-producer', name: 'publish', detail: 'segmentio/kafka-go', package: 'demo/api', topics: ['orders'], site },
    ],
    schemas: [{ name: 'Order', package: 'demo/api', fields: [{ name: 'id', goName: 'ID', type: 'string' }], site }],
    queries: [{ library: 'database/sql', operation: 'exec', method: 'ExecContext', sql: 'INSERT INTO orders\n (id) VALUES ($1)', tables: ['orders'], function: 'Save', package: 'demo/store', site }],
  } as unknown as Parameters<typeof architectureBrief>[0]

  it('gives each action only the part it needs', () => {
    expect(architectureBrief(report, 'api')).toContain('- http POST /orders request: Order response: Order — api/handler.go:12')
    expect(architectureBrief(report, 'api')).toContain('Order {id string}')
    expect(architectureBrief(report, 'data')).toContain('exec orders in Save: INSERT INTO orders (id) VALUES ($1)')
    expect(architectureBrief(report, 'events')).toContain('topics: orders')
    expect(architectureBrief(report, 'events')).not.toContain('POST /orders')
    expect(architectureBrief(report, 'dependencies')).toContain('demo/api: github.com/go-chi/chi/v5')
    expect(architectureBrief(report, 'architecture')).toContain('demo/api -> demo/store')
  })
})
