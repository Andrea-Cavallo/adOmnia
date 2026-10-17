import { beforeEach, describe, expect, it, vi } from 'vitest'

const codeStudio = vi.hoisted(() => ({
  state: {
    activeSessionId: 's1' as string | null,
    documents: {} as Record<string, { document: { id: string; relativePath: string }; buffer: string } | null>,
    updateDocument: vi.fn(),
    ensureDocumentLoaded: vi.fn(),
  },
  setState: vi.fn(),
}))
const lsp = vi.hoisted(() => ({ setState: vi.fn() }))
const api = vi.hoisted(() => ({ createGoIDEFiles: vi.fn() }))

vi.mock('@/lib/monacoSetup', () => ({ monaco: {} }))
vi.mock('@/lib/code-studio-lsp-api', () => ({}))
vi.mock('@/lib/code-studio-api', () => ({ createGoIDEFiles: api.createGoIDEFiles }))
vi.mock('@/stores/codeStudio', () => ({ useCodeStudioStore: { getState: () => codeStudio.state, setState: codeStudio.setState } }))
vi.mock('@/stores/codeStudioLsp', () => ({ useCodeStudioLspStore: { setState: lsp.setState } }))
vi.mock('./codeStudioEditorRegistry', () => ({ activeCodeStudioEditor: () => undefined }))
vi.mock('./codeStudioModelUri', () => ({ editorModelUri: () => 'unused' }))

import type { GoIDEWorkspaceChange } from '@/lib/code-studio-lsp-api'
import { applyCodeStudioWorkspaceChange } from './codeStudioWorkspaceEdits'

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
  codeStudio.state.ensureDocumentLoaded.mockImplementation(async (relativePath: string) => {
    const buffer = buffers[relativePath]
    return buffer === null || buffer === undefined ? null : { document: { id: `doc-${relativePath}`, relativePath }, buffer }
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
})
