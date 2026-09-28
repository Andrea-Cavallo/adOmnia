import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveDocument: vi.fn(),
  checkDocument: vi.fn(),
  closeDocument: vi.fn(),
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
  listGoIDEDirectory: vi.fn(),
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
}))

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
})
