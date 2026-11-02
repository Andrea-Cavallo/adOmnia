import { beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({
  document: { document: { id: 'doc', sessionId: 'session', relativePath: 'service.go', external: false }, dirty: false },
  vcs: { status: { session: { available: true } }, blame: {} as Record<string, unknown[]>, toggleBlame: vi.fn() },
  message: vi.fn(), unsubscribe: vi.fn(),
}))
vi.mock('@/stores/codeStudio', () => ({ useCodeStudioStore: { subscribe: () => fixture.unsubscribe } }))
vi.mock('@/stores/codeStudioVcs', () => ({ useCodeStudioVCSStore: { getState: () => fixture.vcs, subscribe: () => fixture.unsubscribe } }))
vi.mock('@/stores/codeStudioLsp', () => ({ useCodeStudioLspStore: { setState: fixture.message } }))
vi.mock('./codeStudioLanguageFeatures', () => ({ documentForModel: () => fixture.document }))
import { installCodeStudioBlameAction } from './codeStudioBlameAction'

function editorFixture() {
  let action: { run: () => Promise<void>; contextMenuGroupId: string }, cleanup: () => void
  const key = { set: vi.fn(), reset: vi.fn() }, dispose = vi.fn()
  const editor = { createContextKey: () => key, getModel: () => ({}), addAction: (value: typeof action) => { action = value; return { dispose } }, onDidChangeModel: () => ({ dispose }), onDidDispose: (callback: () => void) => { cleanup = callback } }
  installCodeStudioBlameAction(editor as never)
  return { action: action!, cleanup: cleanup!, key }
}
beforeEach(() => { vi.clearAllMocks(); fixture.document.dirty = false; fixture.document.document.external = false; fixture.vcs.blame = {}; fixture.vcs.toggleBlame.mockResolvedValue(undefined) })
describe('editor contextual Git blame', () => {
  it('registers a context-menu action and targets the clicked editor document without an LSP request', async () => {
    const { action, cleanup } = editorFixture()
    expect(action.contextMenuGroupId).toBe('3_git')
    await action.run()
    expect(fixture.vcs.toggleBlame).toHaveBeenCalledWith('session', 'doc', 'service.go')
    cleanup(); expect(fixture.unsubscribe).toHaveBeenCalledTimes(2)
  })
  it('prevents annotations on unsaved content but allows turning existing blame off', async () => {
    fixture.document.dirty = true
    const { action, key } = editorFixture()
    expect(key.set).toHaveBeenLastCalledWith(false)
    await action.run(); expect(fixture.vcs.toggleBlame).not.toHaveBeenCalled()
    fixture.vcs.blame.doc = []
    await action.run(); expect(fixture.vcs.toggleBlame).toHaveBeenCalledOnce()
  })
  it('does not annotate external files', async () => {
    fixture.document.document.external = true
    const { action, key } = editorFixture()
    expect(key.set).toHaveBeenLastCalledWith(false)
    await action.run(); expect(fixture.vcs.toggleBlame).not.toHaveBeenCalled()
  })
})
