import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ saveSessionView: vi.fn(() => Promise.resolve()) }))
const windowApi = vi.hoisted(() => ({
  open: vi.fn(() => Promise.resolve('go-studio-s1')),
  close: vi.fn(() => Promise.resolve()),
  focus: vi.fn(() => Promise.resolve()),
  list: vi.fn(() => Promise.resolve([] as Array<{ sessionId: string; windowId: string }>)),
}))

vi.mock('@/lib/goide-api', () => ({
  subscribeGoIDEEvents: vi.fn(() => () => undefined),
  saveGoIDESessionView: api.saveSessionView,
}))
vi.mock('@/lib/goide-window-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/goide-window-api')>()),
  openGoIDESessionWindow: windowApi.open,
  closeGoIDESessionWindow: windowApi.close,
  focusGoIDESessionWindow: windowApi.focus,
  listGoIDESessionWindows: windowApi.list,
}))

import { goStudioWindowContext } from '@/lib/goide-window-api'
import { useGoIDEStore, type GoIDEEditorDocument } from './goide'
import { useGoIDEWindowsStore } from './goideWindows'

function editorDocument(id: string, sessionId: string, dirty: boolean): GoIDEEditorDocument {
  return {
    document: { id, sessionId, relativePath: `${id}.go`, language: 'go' },
    buffer: dirty ? 'changed' : 'saved', savedContent: 'saved', dirty, saving: false, saveError: null, externalState: null,
  } as unknown as GoIDEEditorDocument
}

const windowChanged = (sessionId: string, windowId: string, previousWindowId: string) => ({
  version: 1, type: 'session.window-changed', sessionId, sequence: 1, timestamp: '', payload: { sessionId, windowId, previousWindowId },
})

describe('Go Studio window context', () => {
  it('recognises a detached window only with window, session and windowId', () => {
    expect(goStudioWindowContext('')).toEqual({ windowId: 'main', pinnedSessionId: null })
    expect(goStudioWindowContext('?window=go-studio&session=s1&windowId=go-studio-s1')).toEqual({ windowId: 'go-studio-s1', pinnedSessionId: 's1' })
    expect(goStudioWindowContext('?window=go-studio&session=s1')).toEqual({ windowId: 'main', pinnedSessionId: null })
    expect(goStudioWindowContext('?window=swagger-editor&session=s1&windowId=x')).toEqual({ windowId: 'main', pinnedSessionId: null })
  })
})

describe('Go Studio window ownership (main window)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGoIDEWindowsStore.setState({ context: { windowId: 'main', pinnedSessionId: null }, owners: {}, error: null })
    useGoIDEStore.setState({ documents: [], activeSessionId: 's1', restoredSessions: { s1: true }, activeDocumentBySession: {} })
  })

  it('refuses to move a project with unsaved buffers: they would be lost', async () => {
    useGoIDEStore.setState({ documents: [editorDocument('a', 's1', true)] })
    expect(await useGoIDEWindowsStore.getState().moveToNewWindow('s1')).toBe(false)
    expect(windowApi.open).not.toHaveBeenCalled()
    expect(useGoIDEWindowsStore.getState().error).toContain('unsaved')
  })

  it('saves the session view before handing the project to the new window', async () => {
    useGoIDEStore.setState({ documents: [editorDocument('a', 's1', false)] })
    expect(await useGoIDEWindowsStore.getState().moveToNewWindow('s1')).toBe(true)
    expect(api.saveSessionView).toHaveBeenCalledWith('s1', expect.objectContaining({ openPaths: ['a.go'] }))
    expect(windowApi.open).toHaveBeenCalledWith('s1')
    expect(api.saveSessionView.mock.invocationCallOrder[0]).toBeLessThan(windowApi.open.mock.invocationCallOrder[0])
  })

  it('closes clean editors when the project moves away, keeps unsaved ones and stops persisting the view', async () => {
    useGoIDEStore.setState({ documents: [editorDocument('a', 's1', false), editorDocument('b', 's1', true), editorDocument('c', 's2', false)] })
    useGoIDEWindowsStore.getState().handleEvent(windowChanged('s1', 'go-studio-s1', 'main'))
    expect(useGoIDEWindowsStore.getState().ownerOf('s1')).toBe('go-studio-s1')
    expect(useGoIDEStore.getState().documents.map((item) => item.document.id)).toEqual(['b', 'c'])
    expect(useGoIDEStore.getState().restoredSessions.s1).toBe(false)
    await useGoIDEStore.getState().persistSessionView('s1')
    expect(api.saveSessionView).not.toHaveBeenCalled()
  })

  it('takes the project back when the separate window closes', () => {
    useGoIDEWindowsStore.setState({ owners: { s1: 'go-studio-s1' } })
    const selectSession = vi.fn(() => Promise.resolve())
    useGoIDEStore.setState({ selectSession })
    useGoIDEWindowsStore.getState().handleEvent(windowChanged('s1', 'main', 'go-studio-s1'))
    expect(useGoIDEWindowsStore.getState().ownsSession('s1')).toBe(true)
    expect(selectSession).toHaveBeenCalledWith('s1')
  })

  it('brings a project back by closing its window, never by forcing ownership', async () => {
    useGoIDEWindowsStore.setState({ owners: { s1: 'go-studio-s1' } })
    await useGoIDEWindowsStore.getState().bringBack('s1')
    expect(windowApi.close).toHaveBeenCalledWith('go-studio-s1')
    await useGoIDEWindowsStore.getState().bringBack('s2')
    expect(windowApi.close).toHaveBeenCalledTimes(1)
  })
})
