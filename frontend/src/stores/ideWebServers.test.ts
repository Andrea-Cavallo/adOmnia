import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  webLanguageServers: vi.fn(),
  startWebLanguageServer: vi.fn(),
  stopWebLanguageServer: vi.fn(),
  installWebTools: vi.fn(),
  confirm: vi.fn(),
  state: { sessions: [{ id: 's1', project: { authorization: 'tooling-permitted' } }], documents: [] as unknown[] },
}))

vi.mock('@/lib/livepreview-api', () => ({
  webLanguageServers: mocks.webLanguageServers,
  startWebLanguageServer: mocks.startWebLanguageServer,
  stopWebLanguageServer: mocks.stopWebLanguageServer,
  installWebTools: mocks.installWebTools,
}))
vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: () => () => undefined }))
vi.mock('@/lib/confirmDialog', () => ({ confirm: mocks.confirm }))
vi.mock('@/stores/goideToast', () => ({ studioToast: vi.fn() }))
vi.mock('@/stores/goide', () => ({ useGoIDEStore: Object.assign(() => undefined, { getState: () => mocks.state, subscribe: () => () => undefined }) }))

import { isWebServerReady, useIdeWebServersStore, webLanguageForEditor, webServerEntry } from './ideWebServers'

const entry = (language: string) => webServerEntry(useIdeWebServersStore.getState(), 's1', language)

beforeEach(() => {
  vi.clearAllMocks()
  useIdeWebServersStore.setState({ servers: {}, dismissed: {}, installing: {} })
  mocks.state.sessions = [{ id: 's1', project: { authorization: 'tooling-permitted' } }]
  mocks.stopWebLanguageServer.mockResolvedValue(undefined)
})

describe('webLanguageForEditor', () => {
  it('maps Monaco ids to the web adapters and leaves Go alone', () => {
    expect(webLanguageForEditor('typescript')).toBe('typescript')
    expect(webLanguageForEditor('javascript')).toBe('typescript')
    expect(webLanguageForEditor('scss')).toBe('css')
    expect(webLanguageForEditor('json')).toBe('json')
    expect(webLanguageForEditor('go')).toBeUndefined()
    expect(webLanguageForEditor('markdown')).toBeUndefined()
  })
})

describe('web language servers', () => {
  it('starts an installed server and tracks it as ready from the backend status', async () => {
    mocks.webLanguageServers.mockResolvedValue([{ language: 'html', available: true }])
    mocks.startWebLanguageServer.mockResolvedValue({ language: 'html', state: 'ready', version: '' })
    await useIdeWebServersStore.getState().ensureStarted('s1', 'html')
    expect(mocks.startWebLanguageServer).toHaveBeenCalledWith('s1', 'html')
    expect(isWebServerReady('s1', 'html')).toBe(true)
  })

  it('reports a missing server without starting anything, so Monaco keeps working', async () => {
    mocks.webLanguageServers.mockResolvedValue([{ language: 'css', available: false, error: 'vscode-css-language-server not found' }])
    await useIdeWebServersStore.getState().ensureStarted('s1', 'css')
    expect(mocks.startWebLanguageServer).not.toHaveBeenCalled()
    expect(entry('css')).toMatchObject({ state: 'missing', error: expect.stringContaining('not found') })
    expect(isWebServerReady('s1', 'css')).toBe(false)
  })

  it('never starts a server in an untrusted project', async () => {
    mocks.state.sessions = [{ id: 's1', project: { authorization: 'restricted' } }]
    await useIdeWebServersStore.getState().ensureStarted('s1', 'html')
    expect(mocks.webLanguageServers).not.toHaveBeenCalled()
    expect(entry('html').state).toBe('stopped')
  })

  it('does not ask the backend again while a server is starting, ready, missing or stopped by the user', async () => {
    mocks.webLanguageServers.mockResolvedValue([{ language: 'json', available: true }])
    mocks.startWebLanguageServer.mockResolvedValue({ language: 'json', state: 'ready' })
    await useIdeWebServersStore.getState().ensureStarted('s1', 'json')
    await useIdeWebServersStore.getState().ensureStarted('s1', 'json')
    expect(mocks.startWebLanguageServer).toHaveBeenCalledTimes(1)
    await useIdeWebServersStore.getState().stop('s1', 'json')
    await useIdeWebServersStore.getState().ensureStarted('s1', 'json')
    expect(mocks.startWebLanguageServer).toHaveBeenCalledTimes(1)
  })

  it('follows crashes and restarts from lsp.status events', () => {
    const store = useIdeWebServersStore.getState()
    store.handleEvent({ version: 1, type: 'lsp.status', sessionId: 's1', sequence: 1, timestamp: '', payload: { language: 'typescript', state: 'crashed', error: 'boom' } })
    expect(entry('typescript')).toMatchObject({ state: 'crashed', error: 'boom' })
    store.handleEvent({ version: 1, type: 'lsp.status', sessionId: 's1', sequence: 2, timestamp: '', payload: { language: 'typescript', state: 'ready', version: '4.0' } })
    expect(entry('typescript')).toMatchObject({ state: 'ready', version: '4.0', error: undefined })
    store.handleEvent({ version: 1, type: 'lsp.status', sessionId: 's1', sequence: 3, timestamp: '', payload: { language: 'go', state: 'ready' } })
    expect(entry('go').state).toBe('stopped')
  })

  it('installs only after the user confirms the exact command', async () => {
    mocks.confirm.mockResolvedValueOnce(false)
    await useIdeWebServersStore.getState().confirmInstall('s1')
    expect(mocks.installWebTools).not.toHaveBeenCalled()
    expect(mocks.confirm.mock.calls[0][0].message).toContain('npm install --prefix')

    mocks.confirm.mockResolvedValueOnce(true)
    mocks.installWebTools.mockResolvedValue({ id: 'run-9' })
    await useIdeWebServersStore.getState().confirmInstall('s1')
    expect(mocks.installWebTools).toHaveBeenCalledWith('s1')
    expect(useIdeWebServersStore.getState().installing.s1).toBe('run-9')
  })

  it('starts missing servers again once the install succeeds', async () => {
    useIdeWebServersStore.setState({ servers: { s1: { html: { state: 'missing', error: 'not found' } } }, installing: { s1: 'run-9' } })
    mocks.state.documents = [{ document: { sessionId: 's1', language: 'html', readOnly: false, external: false } }]
    mocks.webLanguageServers.mockResolvedValue([{ language: 'html', available: true }])
    mocks.startWebLanguageServer.mockResolvedValue({ language: 'html', state: 'ready' })
    useIdeWebServersStore.getState().handleEvent({ version: 1, type: 'run.finished', sessionId: 's1', sequence: 5, timestamp: '', payload: { id: 'run-9', status: 'exited', exitCode: 0 } })
    await vi.waitFor(() => expect(isWebServerReady('s1', 'html')).toBe(true))
    expect(useIdeWebServersStore.getState().installing.s1).toBeNull()
  })
})
