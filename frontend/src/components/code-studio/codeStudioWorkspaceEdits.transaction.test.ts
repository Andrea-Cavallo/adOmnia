import { beforeEach, describe, expect, it, vi } from 'vitest'

const codeStudio = vi.hoisted(() => ({
  state: {
    activeSessionId: 's1' as string | null,
    documents: [] as Array<{ document: { id: string; relativePath: string; sessionId: string }; buffer: string }>,
    updateDocument: vi.fn(),
    ensureDocumentLoaded: vi.fn(),
  },
  setState: vi.fn(),
}))
const lsp = vi.hoisted(() => ({ setState: vi.fn() }))
const api = vi.hoisted(() => ({ createGoIDEFiles: vi.fn() }))

vi.mock('@/lib/monacoRef', () => ({ monaco: {}, isMonacoLoaded: () => false }))
vi.mock('@/lib/code-studio-lsp-api', () => ({}))
vi.mock('@/lib/code-studio-api', () => ({ createGoIDEFiles: api.createGoIDEFiles }))
vi.mock('@/stores/codeStudio', () => ({ useCodeStudioStore: { getState: () => codeStudio.state, setState: codeStudio.setState } }))
vi.mock('@/stores/codeStudioLsp', () => ({ useCodeStudioLspStore: { setState: lsp.setState } }))
vi.mock('./codeStudioEditorRegistry', () => ({ activeCodeStudioEditor: () => undefined }))
vi.mock('./codeStudioModelUri', () => ({ editorModelUri: () => 'unused' }))

import type { GoIDEWorkspaceChange } from '@/lib/code-studio-lsp-api'
import { applyCodeStudioWorkspaceChange, restoreWorkspaceChange } from './codeStudioWorkspaceEdits'
import { useWorkspaceHistory } from '@/stores/codeStudioWorkspaceHistory'

const edit = (line: number, column: number, endColumn: number, text: string) => ({ range: { startLine: line, startColumn: column, endLine: line, endColumn }, text })

/** Rinomina "old" in "fresh" su due file e crea un terzo file, come un refactoring multi-file di gopls. */
function renameChange(): GoIDEWorkspaceChange {
  return {
    label: 'Rename',
    files: [
      { relativePath: 'a.go', edits: [edit(1, 5, 8, 'fresh')], newContent: 'var fresh = 1\n' },
      { relativePath: 'b.go', edits: [edit(1, 5, 8, 'fresh')], newContent: 'use fresh\n' },
      { relativePath: 'c.go', edits: [], newContent: 'package x\n', created: true },
    ],
  } as unknown as GoIDEWorkspaceChange
}

function loadBuffers(buffers: Record<string, string | null>) {
  codeStudio.state.documents = []
  codeStudio.state.ensureDocumentLoaded.mockImplementation(async (relativePath: string) => {
    const buffer = buffers[relativePath]
    if (buffer === null || buffer === undefined) return null
    const document = { document: { id: `doc-${relativePath}`, relativePath, sessionId: 's1' }, buffer }
    codeStudio.state.documents.push(document)
    return document
  })
}

function lastError(): string {
  const call = codeStudio.setState.mock.calls[codeStudio.setState.mock.calls.length - 1]?.[0] as { error?: string } | undefined
  return call?.error ?? ''
}

describe('multi-file refactoring is all or nothing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    codeStudio.state.activeSessionId = 's1'
    codeStudio.state.updateDocument.mockImplementation((id: string, buffer: string) => {
      const document = codeStudio.state.documents.find(item => item.document.id === id)
      if (document) document.buffer = buffer
    })
    useWorkspaceHistory.setState({ sessions: {} })
    api.createGoIDEFiles.mockResolvedValue(undefined)
  })

  it('asks for the preview before touching anything when more than one file changes', async () => {
    loadBuffers({ 'a.go': 'var old = 1\n', 'b.go': 'use old\n' })
    await applyCodeStudioWorkspaceChange(renameChange())
    expect(lsp.setState).toHaveBeenCalledWith({ pendingChange: expect.anything() })
    expect(codeStudio.state.ensureDocumentLoaded).not.toHaveBeenCalled()
    expect(codeStudio.state.updateDocument).not.toHaveBeenCalled()
    expect(api.createGoIDEFiles).not.toHaveBeenCalled()
  })

  it('applies every file and creates new ones exactly once when all buffers still match', async () => {
    loadBuffers({ 'a.go': 'var old = 1\n', 'b.go': 'use old\n' })
    await applyCodeStudioWorkspaceChange(renameChange(), true)
    expect(api.createGoIDEFiles).toHaveBeenCalledWith('s1', [{ relativePath: 'c.go', content: 'package x\n' }])
    expect(codeStudio.state.updateDocument.mock.calls).toEqual([['doc-a.go', 'var fresh = 1\n'], ['doc-b.go', 'use fresh\n']])
  })

  it('rolls back to nothing when one buffer changed while gopls was computing', async () => {
    loadBuffers({ 'a.go': 'var old = 1\n', 'b.go': 'use old // typed meanwhile\n' })
    await applyCodeStudioWorkspaceChange(renameChange(), true)
    expect(codeStudio.state.updateDocument).not.toHaveBeenCalled()
    expect(api.createGoIDEFiles).not.toHaveBeenCalled()
    expect(lastError()).toContain('b.go')
  })

  it('touches no buffer when a file cannot be opened', async () => {
    loadBuffers({ 'a.go': 'var old = 1\n', 'b.go': null })
    await applyCodeStudioWorkspaceChange(renameChange(), true)
    expect(codeStudio.state.updateDocument).not.toHaveBeenCalled()
    expect(api.createGoIDEFiles).not.toHaveBeenCalled()
    expect(lastError()).toContain('could not be opened')
  })

  it('touches no buffer when creating the new files fails halfway', async () => {
    loadBuffers({ 'a.go': 'var old = 1\n', 'b.go': 'use old\n' })
    api.createGoIDEFiles.mockRejectedValue(new Error('c.go already exists'))
    await applyCodeStudioWorkspaceChange(renameChange(), true)
    expect(codeStudio.state.updateDocument).not.toHaveBeenCalled()
    expect(lastError()).toContain('c.go already exists')
  })

  it('records a text-only change and restores every buffer together', async () => {
    loadBuffers({ 'a.go': 'var old = 1\n', 'b.go': 'use old\n' })
    const change = renameChange()
    change.files = change.files.slice(0, 2)
    await applyCodeStudioWorkspaceChange(change, true)
    expect(useWorkspaceHistory.getState().sessions.s1.undo).toHaveLength(1)
    codeStudio.state.documents = [
      { document: { id: 'doc-a.go', relativePath: 'a.go', sessionId: 's1' }, buffer: 'var fresh = 1\n' },
      { document: { id: 'doc-b.go', relativePath: 'b.go', sessionId: 's1' }, buffer: 'use fresh\n' },
    ] as never
    codeStudio.state.updateDocument.mockClear()
    restoreWorkspaceChange()
    expect(codeStudio.state.updateDocument.mock.calls).toEqual([['doc-a.go', 'var old = 1\n'], ['doc-b.go', 'use old\n']])
    expect(useWorkspaceHistory.getState().sessions.s1.redo).toHaveLength(1)
  })

  it('refuses the entire undo when another edit changed one buffer', async () => {
    loadBuffers({ 'a.go': 'var old = 1\n', 'b.go': 'use old\n' })
    const change = renameChange()
    change.files = change.files.slice(0, 2)
    await applyCodeStudioWorkspaceChange(change, true)
    codeStudio.state.documents = [
      { document: { id: 'doc-a.go', relativePath: 'a.go', sessionId: 's1' }, buffer: 'var fresh = 1\n' },
      { document: { id: 'doc-b.go', relativePath: 'b.go', sessionId: 's1' }, buffer: 'user edit' },
    ] as never
    codeStudio.state.updateDocument.mockClear()
    restoreWorkspaceChange()
    expect(codeStudio.state.updateDocument).not.toHaveBeenCalled()
    expect(lastError()).toContain('b.go')
    expect(useWorkspaceHistory.getState().sessions.s1.undo).toHaveLength(1)
  })

  it('does not advertise workspace undo for file creation', async () => {
    loadBuffers({ 'a.go': 'var old = 1\n', 'b.go': 'use old\n' })
    await applyCodeStudioWorkspaceChange(renameChange(), true)
    expect(useWorkspaceHistory.getState().sessions.s1).toBeUndefined()
  })

  it('rechecks the store after asynchronous document loading', async () => {
    loadBuffers({ 'a.go': 'var old = 1\n', 'b.go': 'use old\n' })
    const change = renameChange()
    change.files = change.files.slice(0, 2)
    const pending = applyCodeStudioWorkspaceChange(change, true)
    codeStudio.state.documents[0] = { ...codeStudio.state.documents[0], buffer: 'typed while loading' }
    await pending
    expect(codeStudio.state.updateDocument).not.toHaveBeenCalled()
    expect(lastError()).toContain('a.go')
  })

  it('does not apply a pending change to another active session', async () => {
    loadBuffers({ 'a.go': 'var old = 1\n', 'b.go': 'use old\n' })
    const pending = applyCodeStudioWorkspaceChange(renameChange(), true)
    codeStudio.state.activeSessionId = 's2'
    await pending
    expect(codeStudio.state.updateDocument).not.toHaveBeenCalled()
    expect(api.createGoIDEFiles).not.toHaveBeenCalled()
  })

  it('preserves existing buffers when they become read-only during file creation', async () => {
    loadBuffers({ 'a.go': 'var old = 1\n', 'b.go': 'use old\n' })
    api.createGoIDEFiles.mockImplementationOnce(async () => {
      const current = codeStudio.state.documents[0]
      codeStudio.state.documents[0] = { ...current, document: { ...current.document, readOnly: true } } as never
    })
    await applyCodeStudioWorkspaceChange(renameChange(), true)
    expect(codeStudio.state.updateDocument).not.toHaveBeenCalled()
    expect(lastError()).toContain('New files were created')
  })
})
