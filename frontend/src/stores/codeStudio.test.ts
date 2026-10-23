import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveDocument: vi.fn(),
  checkDocument: vi.fn(),
  closeDocument: vi.fn(),
  listDirectory: vi.fn(),
  confirm: vi.fn(),
  getView: vi.fn(),
  openDocument: vi.fn(),
  writeRunInput: vi.fn(),
}))

vi.mock('@/lib/code-studio-api', () => ({
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
  listGoIDERuns: vi.fn(async () => []),
  listGoIDESessions: vi.fn(),
  listRecentGoIDEProjects: vi.fn(),
  openGoIDEDocument: mocks.openDocument,
  getGoIDESessionView: mocks.getView,
  listGoIDERecoveredBuffers: vi.fn(async () => []),
  listGoIDERunConfigurations: vi.fn(async () => []),
  openGoIDEProject: vi.fn(),
  quickOpenGoIDEFiles: vi.fn(),
  removeRecentGoIDEProject: vi.fn(),
  restartGoIDERun: vi.fn(),
  saveGoIDEDocument: mocks.saveDocument,
  setGoIDEToolAuthorization: vi.fn(),
  startGoIDERun: vi.fn(),
  stopGoIDERun: vi.fn(),
  subscribeGoIDEEvents: vi.fn(() => () => undefined),
  writeGoIDERunInput: mocks.writeRunInput,
  forgetGoIDEBuffer: vi.fn(() => Promise.resolve()),
  rememberGoIDEBuffer: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/confirmDialog', () => ({ confirm: mocks.confirm }))

import { useCodeStudioStore, type GoIDEEditorDocument } from './codeStudio'

describe('program stdin delivery', () => {
  it('reports successful delivery, including an empty line', async () => {
    mocks.writeRunInput.mockResolvedValueOnce(undefined)
    expect(await useCodeStudioStore.getState().sendRunInput('python-run', '\n')).toBe(true)
    expect(mocks.writeRunInput).toHaveBeenCalledWith('python-run', '\n')
  })

  it('reports failed delivery so the console can retain the input', async () => {
    mocks.writeRunInput.mockRejectedValueOnce(new Error('run is not active'))
    expect(await useCodeStudioStore.getState().sendRunInput('java-run', '12\n')).toBe(false)
    expect(useCodeStudioStore.getState().error).toBe('run is not active')
  })
})

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
  useCodeStudioStore.setState({
    activeSessionId: 'session-one',
    documents: [{ ...document, document: { ...document.document } }],
    activeDocumentBySession: { 'session-one': 'document-one' },
    executions: [],
    consoleByRun: {},
    error: null,
  })
})

describe('Code Studio editor state', () => {
  it('publishes the tree while the session view is still loading', async () => {
    useCodeStudioStore.setState({ restoredSessions: {}, directoryEntries: {} })
    let resolveView!: (value: object) => void
    mocks.getView.mockReturnValue(new Promise((resolve) => { resolveView = resolve }))
    const selecting = useCodeStudioStore.getState().selectSession('session-one')
    await vi.waitFor(() => expect(useCodeStudioStore.getState().directoryEntries['session-one']?.['']).toEqual([]))
    resolveView({ openPaths: [], cursors: [] })
    await selecting
    expect(useCodeStudioStore.getState().error).toBeNull()
  })

  it('restores tabs concurrently in saved order and keeps their original session during a switch', async () => {
    useCodeStudioStore.setState({ documents: [], restoredSessions: {} })
    mocks.getView.mockResolvedValue({ openPaths: ['one.go', 'two.go'], activePath: 'one.go', cursors: [] })
    const resolvers: Array<() => void> = []
    mocks.openDocument.mockImplementation((sessionId: string, path: string) => new Promise((resolve) => {
      resolvers.push(() => resolve({ ...document, document: { ...document.document, id: path, sessionId, relativePath: path } }))
    }))
    const restoring = useCodeStudioStore.getState().restoreSessionView('session-one')
    await vi.waitFor(() => expect(mocks.openDocument).toHaveBeenCalledTimes(2))
    useCodeStudioStore.setState({ activeSessionId: 'session-two' })
    resolvers[1]()
    resolvers[0]()
    await restoring
    expect(mocks.openDocument.mock.calls.map((call) => call[0])).toEqual(['session-one', 'session-one'])
    expect(useCodeStudioStore.getState().documents.map((item) => item.document.relativePath)).toEqual(['one.go', 'two.go'])
    expect(useCodeStudioStore.getState().activeSessionId).toBe('session-two')
    expect(useCodeStudioStore.getState().error).toBeNull()
  })

  it('keeps the dirty buffer when an atomic save fails', async () => {
    mocks.saveDocument.mockRejectedValue(new Error('disk full'))
    useCodeStudioStore.getState().updateDocument('document-one', 'package main\n\nfunc main() {}\n')

    expect(useCodeStudioStore.getState().documents[0].dirty).toBe(true)
    expect(await useCodeStudioStore.getState().saveDocument('document-one')).toBe(false)

    const current = useCodeStudioStore.getState().documents[0]
    expect(current.buffer).toContain('func main')
    expect(current.dirty).toBe(true)
    expect(current.saveError).toContain('disk full')
  })

  it('forces a disk reload and asks before discarding unsaved text', async () => {
    useCodeStudioStore.getState().updateDocument('document-one', 'package main\n// mine\n')
    mocks.checkDocument.mockResolvedValue({ documentId: 'document-one', changed: true, content: 'package main\n// disk\n', diskToken: 'token-two', modifiedAt: '' })

    await useCodeStudioStore.getState().reloadDocumentFromDisk('main.go')

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Reload and discard my changes', variant: 'danger' }))
    expect(mocks.checkDocument).toHaveBeenCalledWith('session-one', 'document-one', expect.stringMatching(/^force-reload:/))
    expect(useCodeStudioStore.getState().documents[0]).toMatchObject({ buffer: 'package main\n// disk\n', dirty: false, diskToken: 'token-two', externalState: null })
  })

  it('refreshes the loaded project branch while preserving dirty buffers for resolution', async () => {
    const dirty = { ...document, document: { ...document.document, id: 'document-two', relativePath: 'internal/service.go' }, buffer: 'package main\n// mine\n', dirty: true }
    useCodeStudioStore.setState({ documents: [{ ...document }, dirty], directoryEntries: { 'session-one': { '': [], internal: [], other: [] } } })
    mocks.checkDocument.mockImplementation(async (_session: string, documentId: string) => ({ documentId, changed: true, content: 'package main\n// disk\n', diskToken: 'token-two', modifiedAt: '' }))

    await useCodeStudioStore.getState().refreshProject('internal')

    expect(mocks.listDirectory).toHaveBeenCalledWith('session-one', 'internal', false)
    expect(mocks.listDirectory).not.toHaveBeenCalledWith('session-one', 'other', false)
    const current = useCodeStudioStore.getState().documents.find((item) => item.document.id === 'document-two')
    expect(current).toMatchObject({ buffer: 'package main\n// mine\n', dirty: true })
    expect(current?.externalState?.content).toBe('package main\n// disk\n')
  })

  it('routes process output only to the matching session and run', () => {
    useCodeStudioStore.setState({
      executions: [{
        id: 'run-one', sessionId: 'session-one', kind: 'run', status: 'running', command: 'go run .',
        workingDirectory: '/project', startedAt: '2026-09-28T00:00:00Z', durationMillis: 0,
      }],
    })
    const state = useCodeStudioStore.getState()
    state.handleEvent({ version: 1, type: 'run.output', sessionId: 'session-one', resourceId: 'run-two', sequence: 1, timestamp: '', payload: { runId: 'run-two', stream: 'stdout', text: 'wrong' } })
    expect(useCodeStudioStore.getState().consoleByRun['run-one']).toBeUndefined()

    state.handleEvent({ version: 1, type: 'run.output', sessionId: 'session-one', resourceId: 'run-one', sequence: 2, timestamp: '', payload: { runId: 'run-one', stream: 'stderr', text: 'expected' } })
    expect(useCodeStudioStore.getState().consoleByRun['run-one']).toEqual([{ sequence: 2, stream: 'stderr', text: 'expected' }])
  })

  it('reloads a clean go.mod after a dependency command and only flags a dirty one', async () => {
    const goMod = (id: string, dirty: boolean): GoIDEEditorDocument => ({
      ...document,
      document: { ...document.document, id, uri: `file:///project/${id}/go.mod`, relativePath: `${id}/go.mod`, name: 'go.mod' },
      buffer: dirty ? 'module edited\n' : 'module old\n', savedContent: 'module old\n', dirty,
    })
    useCodeStudioStore.setState({ documents: [goMod('clean', false), goMod('dirty', true), { ...document }] })
    mocks.checkDocument.mockImplementation(async (_session: string, documentId: string) => ({
      documentId, changed: documentId !== 'document-one', content: 'module new\n', diskToken: 'token-two', modifiedAt: '',
    }))
    useCodeStudioStore.getState().handleEvent({
      version: 1, type: 'run.finished', sessionId: 'session-one', resourceId: 'dep', sequence: 1, timestamp: '',
      payload: { id: 'dep', sessionId: 'session-one', kind: 'dependency', status: 'exited', command: 'go get -u ./...', workingDirectory: '/project', startedAt: '', durationMillis: 1 },
    })
    await vi.waitFor(() => expect(useCodeStudioStore.getState().documents.find((item) => item.document.id === 'clean')?.buffer).toBe('module new\n'))
    const documents = useCodeStudioStore.getState().documents
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
    useCodeStudioStore.setState({ documents: [doc('clean', 'a.go', false), doc('dirty', 'b.go', true), doc('gone', 'c.go', false), doc('other', 'd.go', false)], directoryEntries: {} })
    mocks.checkDocument.mockImplementation(async (_session: string, documentId: string) => ({ documentId, changed: true, content: 'new\n', diskToken: 'token-2', modifiedAt: '' }))
    mocks.closeDocument.mockResolvedValue(undefined)
    useCodeStudioStore.getState().handleEvent({
      version: 1, type: 'files.changed', sessionId: 'session-one', resourceId: 'session-one', sequence: 1, timestamp: '',
      payload: { overflow: false, limited: false, changes: [
        { path: '/project/a.go', relativePath: 'a.go', kind: 2 },
        { path: '/project/b.go', relativePath: 'b.go', kind: 2 },
        { path: '/project/c.go', relativePath: 'c.go', kind: 3 },
      ] },
    })
    await vi.waitFor(() => expect(useCodeStudioStore.getState().documents.find((item) => item.document.id === 'clean')?.buffer).toBe('new\n'))
    const documents = useCodeStudioStore.getState().documents
    expect(documents.find((item) => item.document.id === 'dirty')).toMatchObject({ buffer: 'edited\n', dirty: true })
    expect(documents.find((item) => item.document.id === 'dirty')?.externalState?.changed).toBe(true)
    expect(documents.some((item) => item.document.id === 'gone')).toBe(false)
    expect(mocks.checkDocument).not.toHaveBeenCalledWith('session-one', 'other', expect.anything())
  })
})


describe('Save snapshot isolation', () => {
 it('retains typing during an asynchronous save and prevents duplicate writes', async () => {
  let acknowledge!: (value: unknown) => void
  mocks.saveDocument.mockReturnValue(new Promise((resolve) => { acknowledge = resolve }))
  const store = useCodeStudioStore.getState()
  store.updateDocument('document-one', 'submitted')
  const first = store.saveDocument('document-one')
  expect(await store.saveDocument('document-one')).toBe(false)
  expect(mocks.saveDocument).toHaveBeenCalledTimes(1)
  store.updateDocument('document-one', 'newer typing')
  acknowledge({ ...document, content: 'submitted', diskToken: 'token-two' })
  expect(await first).toBe(true)
  expect(useCodeStudioStore.getState().documents[0]).toMatchObject({ buffer: 'newer typing', savedContent: 'submitted', diskToken: 'token-two', dirty: true, saving: false })
 })
 it('cleans only the acknowledged document and undo to the saved text clears dirty', async () => {
  mocks.saveDocument.mockResolvedValue({ ...document, content: 'saved' })
  useCodeStudioStore.setState({ documents: [document, { ...document, document: { ...document.document, id: 'other' }, buffer: 'other unsaved', dirty: true }] })
  const store = useCodeStudioStore.getState()
  store.updateDocument('document-one', 'saved')
  expect(await store.saveDocument('document-one')).toBe(true)
  expect(useCodeStudioStore.getState().documents[0]).toMatchObject({ dirty: false, saving: false })
  expect(useCodeStudioStore.getState().documents[1].dirty).toBe(true)
  store.updateDocument('document-one', 'more')
  store.updateDocument('document-one', 'saved')
  expect(useCodeStudioStore.getState().documents[0].dirty).toBe(false)
 })
})
