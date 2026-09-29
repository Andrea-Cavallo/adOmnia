import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/monacoSetup', () => ({
  monaco: { editor: { TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 }, OverviewRulerLane: { Left: 1, Full: 7 } }, languages: {} },
}))
vi.mock('./goStudioLanguageFeatures', () => ({ documentForModel: vi.fn() }))
vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('@/lib/goide-lsp-api', () => ({}))

import { breakpointDecorations, executionDecorations, expressionAt } from './goStudioDebugEditor'
import { debugRequestForTarget } from './goStudioQuickActions'
import { debugRequestForNode } from './goStudioTestTree'
import { executionPoint, hasLiveDebugger, type GoIDEDebugView } from '@/stores/goideDebug'
import type { GoIDESession } from '@/lib/goide-api'
import type { GoIDETestRun } from '@/lib/goide-tests-api'

const session = { id: 's1', project: { realPath: '/work/app', modules: [{ path: '/work/app' }] } } as unknown as GoIDESession

function view(state: string, frames: GoIDEDebugView['frames'], frameId: number | null): GoIDEDebugView {
  return {
    info: { id: 'd1', sessionId: 's1', state, title: 'main', startedAt: '' },
    threads: [], frames, threadId: 1, frameId, scopes: [], children: {}, watchValues: {}, console: [], loading: false, goroutines: null, goroutinesLoading: false, timeline: [], request: null,
  }
}

describe('Go Studio debugger helpers', () => {
  it('evaluates the identifier under the mouse together with its selector chain', () => {
    const line = '\tfmt.Println(p.Name, total)'
    expect(expressionAt(line, line.indexOf('Name') + 2)).toBe('p.Name')
    expect(expressionAt(line, line.indexOf('total') + 1)).toBe('total')
    expect(expressionAt(line, line.indexOf('(') + 1)).toBeNull()
    expect(expressionAt('x := 42', 6)).toBeNull()
  })

  it('draws verified breakpoints solid and unverified ones hollow only while debugging', () => {
    const states = [{ line: 4, verified: false }, { line: 9, verified: true }]
    expect(breakpointDecorations(states, false).map((item) => item.options.lineNumberClassName)).toEqual(['go-studio-bp', 'go-studio-bp'])
    expect(breakpointDecorations(states, true).map((item) => item.options.lineNumberClassName)).toEqual(['go-studio-bp go-studio-bp-pending', 'go-studio-bp'])
    expect(executionDecorations(null)).toEqual([])
    expect(executionDecorations({ relativePath: 'main.go', line: 7, top: false })[0].options.className).toContain('go-studio-exec-frame')
  })

  it('builds debug requests for main, tests and benchmarks from the gutter', () => {
    expect(debugRequestForTarget(session, { line: 3, kind: 'main', name: 'main', packagePath: './cmd/api' })).toEqual({ sessionId: 's1', workingDirectory: '', target: './cmd/api', mode: 'debug' })
    expect(debugRequestForTarget(session, { line: 5, kind: 'test', name: 'TestSum', packagePath: '.' })).toMatchObject({ mode: 'test', target: '.', testName: '^TestSum$' })
    expect(debugRequestForTarget(session, { line: 9, kind: 'benchmark', name: 'BenchmarkSum', packagePath: '.' })).toMatchObject({ testName: '^$', programArguments: ['-test.bench', '^BenchmarkSum$', '-test.benchtime', '1x'] })
  })

  it('debugs a single subtest from the test tree, never a whole package', () => {
    const run = {
      runId: 'r', sessionId: 's1', status: 'failed', startedAt: '',
      request: { sessionId: 's1', workingDirectory: '', packages: ['./...'], run: '', bench: '', coverage: false, buildTags: ['integration'] },
      results: [{ id: 'p', package: 'example.com/calc', status: 'fail', directory: 'calc' }, { id: 't', package: 'example.com/calc', name: 'TestAdd/negative', status: 'fail' }],
    } as unknown as GoIDETestRun
    expect(debugRequestForNode(run, run.results[1])).toMatchObject({ mode: 'test', target: './calc', testName: '^TestAdd$/^negative$', buildTags: ['integration'] })
    expect(debugRequestForNode(run, run.results[0])).toBeNull()
  })

  it('exposes the execution point only while paused and prefers the selected frame', () => {
    const frames = [{ id: 1, name: 'main.sum', relativePath: 'main.go', line: 16, column: 2 }, { id: 2, name: 'main.main', relativePath: 'main.go', line: 30, column: 2 }]
    const state = (item: GoIDEDebugView) => ({ debuggers: { d1: item }, activeBySession: { s1: 'd1' } })
    expect(executionPoint(state(view('stopped', frames, 1)), 's1')).toEqual({ relativePath: 'main.go', line: 16, top: true })
    expect(executionPoint(state(view('stopped', frames, 2)), 's1')).toEqual({ relativePath: 'main.go', line: 30, top: false })
    expect(executionPoint(state(view('running', frames, 1)), 's1')).toBeNull()
    expect(hasLiveDebugger(state(view('terminated', [], null)), 's1')).toBe(false)
    expect(hasLiveDebugger(state(view('running', [], null)), 's1')).toBe(true)
  })
})
