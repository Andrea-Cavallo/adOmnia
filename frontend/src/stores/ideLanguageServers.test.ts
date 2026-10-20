import { useCodeStudioLspStore } from './codeStudioLsp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  languageServers: vi.fn(),
  startLanguageServer: vi.fn(),
  stopLanguageServer: vi.fn(),
  previewServerInstall: vi.fn(),
  installLanguageServer: vi.fn(),
  confirm: vi.fn(),
  beginToolInstall: vi.fn(),
  endToolInstall: vi.fn(),
  state: { sessions: [{ id: 's1', project: { authorization: 'tooling-permitted' } }], documents: [] as unknown[] },
}))

vi.mock('@/lib/ide-servers-api', () => ({
  languageServers: mocks.languageServers,
  startLanguageServer: mocks.startLanguageServer,
  stopLanguageServer: mocks.stopLanguageServer,
  previewServerInstall: mocks.previewServerInstall,
  installLanguageServer: mocks.installLanguageServer,
}))
vi.mock('@/lib/code-studio-api', () => ({ subscribeGoIDEEvents: () => () => undefined }))
vi.mock('@/lib/confirmDialog', () => ({ confirm: mocks.confirm }))
vi.mock('@/stores/codeStudioToast', () => ({ studioToast: vi.fn() }))
vi.mock('@/stores/codeStudioToolInstall', () => ({ beginToolInstall: mocks.beginToolInstall, endToolInstall: mocks.endToolInstall }))
vi.mock('@/stores/codeStudio', () => ({ useCodeStudioStore: Object.assign(() => undefined, { getState: () => mocks.state, subscribe: () => () => undefined }) }))

import { isServerReady, useIdeLanguageServersStore, serverLanguageForEditor, serverEntry, autoStartLanguagesFor } from './ideLanguageServers'

const RUN = { runId: 'run-9', task: 'install-web-language-servers', languages: ['html'] }
const entry = (language: string) => serverEntry(useIdeLanguageServersStore.getState(), 's1', language)

beforeEach(() => {
  vi.clearAllMocks()
  useCodeStudioLspStore.setState(state => ({ preferences: { ...state.preferences, resourceMode: 'normal' } }))
  useIdeLanguageServersStore.setState({ servers: {}, dismissed: {}, installing: {} })
  mocks.state.sessions = [{ id: 's1', project: { authorization: 'tooling-permitted' } }]
  mocks.stopLanguageServer.mockResolvedValue(undefined)
})

describe('autoStartLanguagesFor', () => {
  it('starts JDT LS for Java units without waiting for an open file', () => {
    // Eclipse JDT LS importa i progetti Maven/Gradle multi-modulo per minuti: parte già
    // all'apertura del Code Studio, gli altri linguaggi restano pigri.
    expect(autoStartLanguagesFor([{ language: 'java' }])).toEqual(['java'])
    expect(autoStartLanguagesFor([{ language: 'java' }, { language: 'java' }])).toEqual(['java'])
    expect(autoStartLanguagesFor([{ language: 'go' }, { language: 'typescript' }])).toEqual([])
    expect(autoStartLanguagesFor(undefined)).toEqual([])
    expect(autoStartLanguagesFor([{ language: 'go' }, { language: 'java' }])).toEqual(['java'])
  })
})

describe('serverLanguageForEditor', () => {
  it('maps Monaco ids to the web adapters and leaves Go alone', () => {
    expect(serverLanguageForEditor('typescript')).toBe('typescript')
    expect(serverLanguageForEditor('javascript')).toBe('typescript')
    expect(serverLanguageForEditor('scss')).toBe('css')
    expect(serverLanguageForEditor('json')).toBe('json')
    expect(serverLanguageForEditor('go')).toBeUndefined()
    expect(serverLanguageForEditor('markdown')).toBeUndefined()
    expect(serverLanguageForEditor('java')).toBe('java')
  })
})

describe('web language servers', () => {
  it('keeps language servers available while low resources is active', async () => {
    useCodeStudioLspStore.setState(state => ({ preferences: { ...state.preferences, resourceMode: 'low' } }))
    mocks.languageServers.mockResolvedValue([{ language: 'html', available: true }])
    mocks.startLanguageServer.mockResolvedValue({ language: 'html', state: 'ready', version: '' })
    await useIdeLanguageServersStore.getState().ensureStarted('s1', 'html')
    expect(mocks.startLanguageServer).toHaveBeenCalledWith('s1', 'html')
  })

  it('starts an installed server and tracks it as ready from the backend status', async () => {
    mocks.languageServers.mockResolvedValue([{ language: 'html', available: true }])
    mocks.startLanguageServer.mockResolvedValue({ language: 'html', state: 'ready', version: '' })
    await useIdeLanguageServersStore.getState().ensureStarted('s1', 'html')
    expect(mocks.startLanguageServer).toHaveBeenCalledWith('s1', 'html')
    expect(isServerReady('s1', 'html')).toBe(true)
  })

  it('reports a missing server without starting anything, so Monaco keeps working', async () => {
    mocks.languageServers.mockResolvedValue([{ language: 'css', available: false, error: 'vscode-css-language-server not found' }])
    await useIdeLanguageServersStore.getState().ensureStarted('s1', 'css')
    expect(mocks.startLanguageServer).not.toHaveBeenCalled()
    expect(entry('css')).toMatchObject({ state: 'missing', error: expect.stringContaining('not found') })
    expect(isServerReady('s1', 'css')).toBe(false)
  })

  it('never starts a server in an untrusted project', async () => {
    mocks.state.sessions = [{ id: 's1', project: { authorization: 'restricted' } }]
    await useIdeLanguageServersStore.getState().ensureStarted('s1', 'html')
    expect(mocks.languageServers).not.toHaveBeenCalled()
    expect(entry('html').state).toBe('stopped')
  })

  it('does not ask the backend again while a server is starting, ready, missing or stopped by the user', async () => {
    mocks.languageServers.mockResolvedValue([{ language: 'json', available: true }])
    mocks.startLanguageServer.mockResolvedValue({ language: 'json', state: 'ready' })
    await useIdeLanguageServersStore.getState().ensureStarted('s1', 'json')
    await useIdeLanguageServersStore.getState().ensureStarted('s1', 'json')
    expect(mocks.startLanguageServer).toHaveBeenCalledTimes(1)
    await useIdeLanguageServersStore.getState().stop('s1', 'json')
    await useIdeLanguageServersStore.getState().ensureStarted('s1', 'json')
    expect(mocks.startLanguageServer).toHaveBeenCalledTimes(1)
  })

  it('follows crashes and restarts from lsp.status events', () => {
    const store = useIdeLanguageServersStore.getState()
    store.handleEvent({ version: 1, type: 'lsp.status', sessionId: 's1', sequence: 1, timestamp: '', payload: { language: 'typescript', state: 'crashed', error: 'boom' } })
    expect(entry('typescript')).toMatchObject({ state: 'crashed', error: 'boom' })
    store.handleEvent({ version: 1, type: 'lsp.status', sessionId: 's1', sequence: 2, timestamp: '', payload: { language: 'typescript', state: 'ready', version: '4.0' } })
    expect(entry('typescript')).toMatchObject({ state: 'ready', version: '4.0', error: undefined })
    store.handleEvent({ version: 1, type: 'lsp.status', sessionId: 's1', sequence: 3, timestamp: '', payload: { language: 'go', state: 'ready' } })
    expect(entry('go').state).toBe('stopped')
  })

  it('installs only after the user confirms the exact command', async () => {
    mocks.previewServerInstall.mockResolvedValue({ task: 'install-web-language-servers', title: 'Install?', label: 'Installing language servers…', note: 'note', command: 'npm install --prefix <tools>', languages: ['typescript', 'html'] })
    mocks.confirm.mockResolvedValueOnce(false)
    await useIdeLanguageServersStore.getState().confirmInstall('s1', 'typescript')
    expect(mocks.installLanguageServer).not.toHaveBeenCalled()
    expect(mocks.confirm.mock.calls[0][0].message).toContain('npm install --prefix')

    mocks.confirm.mockResolvedValueOnce(true)
    mocks.installLanguageServer.mockResolvedValue({ id: 'run-9' })
    await useIdeLanguageServersStore.getState().confirmInstall('s1', 'typescript')
    expect(mocks.installLanguageServer).toHaveBeenCalledWith('s1', 'typescript')
    // Un'installazione sblocca tutti i linguaggi che la condividono.
    expect(useIdeLanguageServersStore.getState().installing.s1.html.runId).toBe('run-9')
    // L'installazione parte in background: console Run in primo piano e attività nella status bar.
    expect(mocks.beginToolInstall).toHaveBeenCalledWith('s1', 'install-web-language-servers', expect.stringContaining('language servers'))
  })

  it('starts missing servers again once the install succeeds', async () => {
    useIdeLanguageServersStore.setState({ servers: { s1: { html: { state: 'missing', error: 'not found' } } }, installing: { s1: { html: RUN } } })
    mocks.state.documents = [{ document: { sessionId: 's1', language: 'html', readOnly: false, external: false } }]
    mocks.languageServers.mockResolvedValue([{ language: 'html', available: true }])
    mocks.startLanguageServer.mockResolvedValue({ language: 'html', state: 'ready' })
    useIdeLanguageServersStore.getState().handleEvent({ version: 1, type: 'run.finished', sessionId: 's1', sequence: 5, timestamp: '', payload: { id: 'run-9', status: 'exited', exitCode: 0 } })
    await vi.waitFor(() => expect(isServerReady('s1', 'html')).toBe(true))
    expect(useIdeLanguageServersStore.getState().installing.s1).toEqual({})
    expect(mocks.endToolInstall).toHaveBeenCalledWith('s1', 'install-web-language-servers', true)
  })

  it('unblocks the same missing server in the other sessions too: the tools folder is shared', async () => {
    useIdeLanguageServersStore.setState({ servers: { s1: { html: { state: 'missing' } }, s2: { html: { state: 'missing' }, css: { state: 'missing' } } }, installing: { s1: { html: RUN } } })
    mocks.state.documents = []
    useIdeLanguageServersStore.getState().handleEvent({ version: 1, type: 'run.finished', sessionId: 's1', sequence: 7, timestamp: '', payload: { id: 'run-9', status: 'exited', exitCode: 0 } })
    const servers = useIdeLanguageServersStore.getState().servers
    expect(servers.s2.html.state).toBe('stopped')
    expect(servers.s2.css.state).toBe('missing')
  })

  it('reports a failed install so the Run console comes back with the error', () => {
    useIdeLanguageServersStore.setState({ installing: { s1: { html: RUN } } })
    useIdeLanguageServersStore.getState().handleEvent({ version: 1, type: 'run.finished', sessionId: 's1', sequence: 6, timestamp: '', payload: { id: 'run-9', status: 'failed', exitCode: 1 } })
    expect(mocks.endToolInstall).toHaveBeenCalledWith('s1', 'install-web-language-servers', false)
  })
})
