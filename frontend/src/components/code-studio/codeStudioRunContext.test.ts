import { describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/codeStudio', () => ({ useCodeStudioStore: { getState: () => ({}) } }))

const { contextRunTarget } = await import('./codeStudioRunTargets')
const { pinnedFirst } = await import('@/lib/code-studio/codeStudioRunHistory')
const { runsToRestart } = await import('./codeStudioRunOnSave')

const TEST_FILE = ['package geom', '', 'func TestArea(t *testing.T) {', '\tt.Log("a")', '}', '', 'func TestPerimeter(t *testing.T) {', '\tt.Log("p")', '}', ''].join('\n')

describe('run context, pins and restart on save', () => {
  it('picks the test under the cursor, the main of a main package, or nothing', () => {
    expect(contextRunTarget('geom/geom_test.go', TEST_FILE, 8)).toMatchObject({ name: 'TestPerimeter', kind: 'test', packagePath: './geom' })
    expect(contextRunTarget('geom/geom_test.go', TEST_FILE, 1)).toBeNull()
    expect(contextRunTarget('cmd/api/main.go', 'package main\n\nfunc helper() {}\n\nfunc main() {}\n', 3)).toMatchObject({ kind: 'main', packagePath: './cmd/api' })
    expect(contextRunTarget('geom/geom.go', 'package geom\n', 1)).toBeNull()
  })

  it('puts pinned configurations first and keeps the user order otherwise', () => {
    expect(pinnedFirst([{ id: 'a' }, { id: 'b', pinned: true }, { id: 'c' }]).map((item) => item.id)).toEqual(['b', 'a', 'c'])
  })

  it('restarts only running executions of configurations with restart on save', () => {
    const state = {
      executions: [
        { id: 'r1', sessionId: 's', status: 'running' },
        { id: 'r2', sessionId: 's', status: 'running' },
        { id: 'r3', sessionId: 's', status: 'exited' },
      ],
      configByRun: { r1: 'hot', r2: 'cold', r3: 'hot' },
      runConfigsBySession: { s: [{ id: 'hot', restartOnSave: true }, { id: 'cold' }] },
    } as unknown as Parameters<typeof runsToRestart>[0]
    expect(runsToRestart(state, 's')).toEqual(['r1'])
  })

  it('restarts only the runs a saved file belongs to (language and working directory)', () => {
    const state = {
      executions: [{ id: 'go', sessionId: 's', status: 'running' }, { id: 'web', sessionId: 's', status: 'running' }],
      configByRun: { go: 'orders', web: 'ui' },
      runConfigsBySession: { s: [
        { id: 'orders', restartOnSave: true, workingDirectory: 'orders' },
        { id: 'ui', restartOnSave: true, language: 'typescript', workingDirectory: 'web' },
      ] },
    } as unknown as Parameters<typeof runsToRestart>[0]
    expect(runsToRestart(state, 's', { relativePath: 'orders/main.go', editorLanguage: 'go' })).toEqual(['go'])
    expect(runsToRestart(state, 's', { relativePath: 'web/src/App.tsx', editorLanguage: 'typescript' })).toEqual(['web'])
    expect(runsToRestart(state, 's', { relativePath: 'web/main.go', editorLanguage: 'go' })).toEqual([])
    expect(runsToRestart(state, 's', { relativePath: 'orders-legacy/main.go', editorLanguage: 'go' })).toEqual([])
    expect(runsToRestart(state, 's', { relativePath: 'docs/readme.md', editorLanguage: 'markdown' })).toEqual([])
  })
})
