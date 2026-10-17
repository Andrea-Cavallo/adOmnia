import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ saveSessionView: vi.fn(() => Promise.resolve()) }))
const windowApi = vi.hoisted(() => ({
  open: vi.fn(() => Promise.resolve('code-studio-s1')),
  close: vi.fn(() => Promise.resolve()),
  focus: vi.fn(() => Promise.resolve()),
  list: vi.fn(() => Promise.resolve([] as Array<{ sessionId: string; windowId: string }>)),
}))

vi.mock('@/lib/code-studio-api', () => ({
  subscribeGoIDEEvents: vi.fn(() => () => undefined),
  saveGoIDESessionView: api.saveSessionView,
}))
vi.mock('@/lib/code-studio-window-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/code-studio-window-api')>()),
  openGoIDESessionWindow: windowApi.open,
  closeGoIDESessionWindow: windowApi.close,
  focusGoIDESessionWindow: windowApi.focus,
  listGoIDESessionWindows: windowApi.list,
}))

import { codeStudioWindowContext } from '@/lib/code-studio-window-api'
import { useCodeStudioStore, type GoIDEEditorDocument } from './codeStudio'
import { useCodeStudioWindowsStore } from './codeStudioWindows'

function editorDocument(id: string, sessionId: string, dirty: boolean): GoIDEEditorDocument {
  return {
    document: { id, sessionId, relativePath: `${id}.go`, language: 'go' },
    buffer: dirty ? 'changed' : 'saved', savedContent: 'saved', dirty, saving: false, saveError: null, externalState: null,
  } as unknown as GoIDEEditorDocument
}

const windowChanged = (sessionId: string, windowId: string, previousWindowId: string) => ({
  version: 1, type: 'session.window-changed', sessionId, sequence: 1, timestamp: '', payload: { sessionId, windowId, previousWindowId },
})

describe('Code Studio window context', () => {
  it('recognises a detached window only with window, session and windowId', () => {
    expect(codeStudioWindowContext('')).toEqual({ windowId: 'main', pinnedSessionId: null })
    expect(codeStudioWindowContext('?window=code-studio&session=s1&windowId=code-studio-s1')).toEqual({ windowId: 'code-studio-s1', pinnedSessionId: 's1' })
    expect(codeStudioWindowContext('?window=code-studio&session=s1')).toEqual({ windowId: 'main', pinnedSessionId: null })
    expect(codeStudioWindowContext('?window=swagger-editor&session=s1&windowId=x')).toEqual({ windowId: 'main', pinnedSessionId: null })
  })
})

describe('Code Studio window ownership (main window)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCodeStudioWindowsStore.setState({ context: { windowId: 'main', pinnedSessionId: null }, owners: {}, error: null })
    useCodeStudioStore.setState({ documents: [], activeSessionId: 's1', restoredSessions: { s1: true }, activeDocumentBySession: {} })
  })

  it('refuses to move a project with unsaved buffers: they would be lost', async () => {
    useCodeStudioStore.setState({ documents: [editorDocument('a', 's1', true)] })
    expect(await useCodeStudioWindowsStore.getState().moveToNewWindow('s1')).toBe(false)
    expect(windowApi.open).not.toHaveBeenCalled()
    expect(useCodeStudioWindowsStore.getState().error).toContain('unsaved')
  })

  it('saves the session view before handing the project to the new window', async () => {
    useCodeStudioStore.setState({ documents: [editorDocument('a', 's1', false)] })
    expect(await useCodeStudioWindowsStore.getState().moveToNewWindow('s1')).toBe(true)
    expect(api.saveSessionView).toHaveBeenCalledWith('s1', expect.objectContaining({ openPaths: ['a.go'] }))
    expect(windowApi.open).toHaveBeenCalledWith('s1')
    expect(api.saveSessionView.mock.invocationCallOrder[0]).toBeLessThan(windowApi.open.mock.invocationCallOrder[0])
  })

  it('closes clean editors when the project moves away, keeps unsaved ones and stops persisting the view', async () => {
    useCodeStudioStore.setState({ documents: [editorDocument('a', 's1', false), editorDocument('b', 's1', true), editorDocument('c', 's2', false)] })
    useCodeStudioWindowsStore.getState().handleEvent(windowChanged('s1', 'code-studio-s1', 'main'))
    expect(useCodeStudioWindowsStore.getState().ownerOf('s1')).toBe('code-studio-s1')
    expect(useCodeStudioStore.getState().documents.map((item) => item.document.id)).toEqual(['b', 'c'])
    expect(useCodeStudioStore.getState().restoredSessions.s1).toBe(false)
    await useCodeStudioStore.getState().persistSessionView('s1')
    expect(api.saveSessionView).not.toHaveBeenCalled()
  })

  it('takes the project back when the separate window closes', () => {
    useCodeStudioWindowsStore.setState({ owners: { s1: 'code-studio-s1' } })
    const selectSession = vi.fn(() => Promise.resolve())
    useCodeStudioStore.setState({ selectSession })
    useCodeStudioWindowsStore.getState().handleEvent(windowChanged('s1', 'main', 'code-studio-s1'))
    expect(useCodeStudioWindowsStore.getState().ownsSession('s1')).toBe(true)
    expect(selectSession).toHaveBeenCalledWith('s1')
  })

  it('brings a project back by closing its window, never by forcing ownership', async () => {
    useCodeStudioWindowsStore.setState({ owners: { s1: 'code-studio-s1' } })
    await useCodeStudioWindowsStore.getState().bringBack('s1')
    expect(windowApi.close).toHaveBeenCalledWith('code-studio-s1')
    await useCodeStudioWindowsStore.getState().bringBack('s2')
    expect(windowApi.close).toHaveBeenCalledTimes(1)
  })
})
