import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveDocument: vi.fn(),
  checkDocument: vi.fn(),
  closeDocument: vi.fn(),
  listDirectory: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('@/lib/goide-api', () => ({
  checkGoIDEDocument: mocks.checkDocument,
  chooseGoIDEProjectFolder: vi.fn(),
  closeGoIDEDocument: mocks.closeDocument,
  closeGoIDESession: vi.fn(),
  configureGoIDEToolchain: vi.fn(),
  createGoIDEProject: vi.fn(),
  detectGoIDEToolchain: vi.fn(),
  getGoIDECapabilities: vi.fn(),
  hasActiveGoIDERuns: vi.fn(),
  listGoIDEDirectory: mocks.listDirectory,
  listGoIDERuns: vi.fn(),
  listGoIDESessions: vi.fn(),
  listRecentGoIDEProjects: vi.fn(),
  openGoIDEDocument: vi.fn(),
  openGoIDEProject: vi.fn(),
  quickOpenGoIDEFiles: vi.fn(),
  removeRecentGoIDEProject: vi.fn(),
  restartGoIDERun: vi.fn(),
  saveGoIDEDocument: mocks.saveDocument,
  setGoIDEToolAuthorization: vi.fn(),
  startGoIDERun: vi.fn(),
  stopGoIDERun: vi.fn(),
  subscribeGoIDEEvents: vi.fn(() => () => undefined),
  writeGoIDERunInput: vi.fn(),
  forgetGoIDEBuffer: vi.fn(() => Promise.resolve()),
  rememberGoIDEBuffer: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/confirmDialog', () => ({ confirm: mocks.confirm }))

import { useGoIDEStore, type GoIDEEditorDocument } from './goide'

const document: GoIDEEditorDocument = {
  document: {
    id: 'document-one',
    sessionId: 'session-one',
    uri: 'file:///project/main.go',
    path: '/project/main.go',
    relativePath: 'main.go',
    name: 'main.go',
    language: 'go',
    version: 1,
    dirty: false,
  },
  content: 'package main\n',
  buffer: 'package main\n',
  savedContent: 'package main\n',
  diskToken: 'token-one',
  modifiedAt: '2026-09-28T00:00:00Z',
  dirty: false,
  saving: false,
  saveError: null,
  externalState: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkDocument.mockResolvedValue({ documentId: 'document-one', changed: false, diskToken: 'token-one', modifiedAt: '2026-09-28T00:00:00Z' })
  mocks.listDirectory.mockResolvedValue([])
  mocks.confirm.mockResolvedValue(true)
  useGoIDEStore.setState({
    activeSessionId: 'session-one',
    documents: [{ ...document, document: { ...document.document } }],
    activeDocumentBySession: { 'session-one': 'document-one' },
    executions: [],
    consoleByRun: {},
    error: null,
  })
})

describe('Go Studio editor state', () => {
  it('keeps the dirty buffer when an atomic save fails', async () => {
    mocks.saveDocument.mockRejectedValue(new Error('disk full'))
    useGoIDEStore.getState().updateDocument('document-one', 'package main\n\nfunc main() {}\n')

    expect(useGoIDEStore.getState().documents[0].dirty).toBe(true)
    expect(await useGoIDEStore.getState().saveDocument('document-one')).toBe(false)

    const current = useGoIDEStore.getState().documents[0]
    expect(current.buffer).toContain('func main')
    expect(current.dirty).toBe(true)
    expect(current.saveError).toContain('disk full')
  })

  it('forces a disk reload and asks before discarding unsaved text', async () => {
    useGoIDEStore.getState().updateDocument('document-one', 'package main\n// mine\n')
    mocks.checkDocument.mockResolvedValue({ documentId: 'document-one', changed: true, content: 'package main\n// disk\n', diskToken: 'token-two', modifiedAt: '' })

    await useGoIDEStore.getState().reloadDocumentFromDisk('main.go')

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Reload and discard my changes', variant: 'danger' }))
    expect(mocks.checkDocument).toHaveBeenCalledWith('session-one', 'document-one', expect.stringMatching(/^force-reload:/))
    expect(useGoIDEStore.getState().documents[0]).toMatchObject({ buffer: 'package main\n// disk\n', dirty: false, diskToken: 'token-two', externalState: null })
  })

  it('refreshes the loaded project branch while preserving dirty buffers for resolution', async () => {
    const dirty = { ...document, document: { ...document.document, id: 'document-two', relativePath: 'internal/service.go' }, buffer: 'package main\n// mine\n', dirty: true }
    useGoIDEStore.setState({ documents: [{ ...document }, dirty], directoryEntries: { 'session-one': { '': [], internal: [], other: [] } } })
    mocks.checkDocument.mockImplementation(async (_session: string, documentId: string) => ({ documentId, changed: true, content: 'package main\n// disk\n', diskToken: 'token-two', modifiedAt: '' }))

    await useGoIDEStore.getState().refreshProject('internal')

    expect(mocks.listDirectory).toHaveBeenCalledWith('session-one', 'internal', false)
    expect(mocks.listDirectory).not.toHaveBeenCalledWith('session-one', 'other', false)
    const current = useGoIDEStore.getState().documents.find((item) => item.document.id === 'document-two')
    expect(current).toMatchObject({ buffer: 'package main\n// mine\n', dirty: true })
    expect(current?.externalState?.content).toBe('package main\n// disk\n')
  })

  it('routes process output only to the matching session and run', () => {
    useGoIDEStore.setState({
      executions: [{
        id: 'run-one', sessionId: 'session-one', kind: 'run', status: 'running', command: 'go run .',
        workingDirectory: '/project', startedAt: '2026-09-28T00:00:00Z', durationMillis: 0,
      }],
    })
    const state = useGoIDEStore.getState()
    state.handleEvent({ version: 1, type: 'run.output', sessionId: 'session-one', resourceId: 'run-two', sequence: 1, timestamp: '', payload: { runId: 'run-two', stream: 'stdout', text: 'wrong' } })
    expect(useGoIDEStore.getState().consoleByRun['run-one']).toBeUndefined()

    state.handleEvent({ version: 1, type: 'run.output', sessionId: 'session-one', resourceId: 'run-one', sequence: 2, timestamp: '', payload: { runId: 'run-one', stream: 'stderr', text: 'expected' } })
    expect(useGoIDEStore.getState().consoleByRun['run-one']).toEqual([{ sequence: 2, stream: 'stderr', text: 'expected' }])
  })

  it('reloads a clean go.mod after a dependency command and only flags a dirty one', async () => {
    const goMod = (id: string, dirty: boolean): GoIDEEditorDocument => ({
      ...document,
      document: { ...document.document, id, uri: `file:///project/${id}/go.mod`, relativePath: `${id}/go.mod`, name: 'go.mod' },
      buffer: dirty ? 'module edited\n' : 'module old\n', savedContent: 'module old\n', dirty,
    })
    useGoIDEStore.setState({ documents: [goMod('clean', false), goMod('dirty', true), { ...document }] })
    mocks.checkDocument.mockImplementation(async (_session: string, documentId: string) => ({
      documentId, changed: documentId !== 'document-one', content: 'module new\n', diskToken: 'token-two', modifiedAt: '',
    }))
    useGoIDEStore.getState().handleEvent({
      version: 1, type: 'run.finished', sessionId: 'session-one', resourceId: 'dep', sequence: 1, timestamp: '',
      payload: { id: 'dep', sessionId: 'session-one', kind: 'dependency', status: 'exited', command: 'go get -u ./...', workingDirectory: '/project', startedAt: '', durationMillis: 1 },
    })
    await vi.waitFor(() => expect(useGoIDEStore.getState().documents.find((item) => item.document.id === 'clean')?.buffer).toBe('module new\n'))
    const documents = useGoIDEStore.getState().documents
    expect(documents.find((item) => item.document.id === 'clean')).toMatchObject({ dirty: false, externalState: null, diskToken: 'token-two' })
    expect(documents.find((item) => item.document.id === 'dirty')).toMatchObject({ buffer: 'module edited\n', dirty: true })
    expect(documents.find((item) => item.document.id === 'dirty')?.externalState?.changed).toBe(true)
    expect(mocks.checkDocument).not.toHaveBeenCalledWith('session-one', 'document-one', expect.anything())
  })

  it('reacts to disk changes: reloads clean buffers, flags dirty ones, closes clean deleted files', async () => {
    const doc = (id: string, relativePath: string, dirty: boolean): GoIDEEditorDocument => ({
      ...document,
      document: { ...document.document, id, uri: `file:///project/${relativePath}`, relativePath, name: relativePath },
      buffer: dirty ? 'edited\n' : 'old\n', savedContent: 'old\n', dirty,
    })
    useGoIDEStore.setState({ documents: [doc('clean', 'a.go', false), doc('dirty', 'b.go', true), doc('gone', 'c.go', false), doc('other', 'd.go', false)], directoryEntries: {} })
    mocks.checkDocument.mockImplementation(async (_session: string, documentId: string) => ({ documentId, changed: true, content: 'new\n', diskToken: 'token-2', modifiedAt: '' }))
    mocks.closeDocument.mockResolvedValue(undefined)
    useGoIDEStore.getState().handleEvent({
      version: 1, type: 'files.changed', sessionId: 'session-one', resourceId: 'session-one', sequence: 1, timestamp: '',
      payload: { overflow: false, limited: false, changes: [
        { path: '/project/a.go', relativePath: 'a.go', kind: 2 },
        { path: '/project/b.go', relativePath: 'b.go', kind: 2 },
        { path: '/project/c.go', relativePath: 'c.go', kind: 3 },
      ] },
    })
    await vi.waitFor(() => expect(useGoIDEStore.getState().documents.find((item) => item.document.id === 'clean')?.buffer).toBe('new\n'))
    const documents = useGoIDEStore.getState().documents
    expect(documents.find((item) => item.document.id === 'dirty')).toMatchObject({ buffer: 'edited\n', dirty: true })
    expect(documents.find((item) => item.document.id === 'dirty')?.externalState?.changed).toBe(true)
    expect(documents.some((item) => item.document.id === 'gone')).toBe(false)
    expect(mocks.checkDocument).not.toHaveBeenCalledWith('session-one', 'other', expect.anything())
  })
})
