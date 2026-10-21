import { toolKey, useStudioTools } from '@/components/code-studio/studioToolState'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/code-studio-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('@/lib/code-studio-lsp-api', () => ({
  detectGopls: vi.fn(), installGopls: vi.fn(), restartLanguageServer: vi.fn(), startLanguageServer: vi.fn(),
  stopLanguageServer: vi.fn(), getLanguageServerStatus: vi.fn(), openExternalDocument: vi.fn(),
}))

import { diagnosticCounts, isGoplsInstall, useCodeStudioLspStore } from './codeStudioLsp'
import { getLanguageServerStatus, restartLanguageServer, startLanguageServer } from '@/lib/code-studio-lsp-api'
import { useCodeStudioStore } from './codeStudio'
import { subscribeGoIDEEvents, type GoIDEEvent } from '@/lib/code-studio-api'

const report = (uri: string, severity: number) => ({
  uri, path: uri.replace('file://', ''), relativePath: 'main.go',
  diagnostics: [{ range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }, severity, message: 'x' }],
})

const event = (sessionId: string, type: string, payload: unknown) => ({ version: 1, type, sessionId, sequence: 1, timestamp: '', payload })

describe('Code Studio language server store', () => {
  beforeEach(() => useCodeStudioLspStore.setState({ diagnostics: {}, status: {}, progress: {}, activity: {} }))

  it('keeps multi-row tabs off by default and persists the toggle', () => {
    expect(useCodeStudioLspStore.getState().preferences.multilineTabs).toBe(false)
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem })
    vi.stubGlobal('window', { dispatchEvent: vi.fn() })
    try {
      useCodeStudioLspStore.getState().updatePreferences({ multilineTabs: true })
      expect(useCodeStudioLspStore.getState().preferences.multilineTabs).toBe(true)
      expect(setItem).toHaveBeenCalled()
      useCodeStudioLspStore.getState().updatePreferences({ multilineTabs: false })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('updates the diagnostics store once for an import burst of 1000 files', async () => {
    vi.useFakeTimers()
    let receive: ((event: GoIDEEvent) => void) | undefined
    vi.mocked(subscribeGoIDEEvents).mockImplementationOnce((listener) => { receive = listener; return () => undefined })
    try {
      await useCodeStudioLspStore.getState().ensureStarted('untrusted-import')
      expect(receive).toBeDefined()
      let changes = 0
      const stop = useCodeStudioLspStore.subscribe((state, previous) => {
        if (state.diagnostics !== previous.diagnostics) changes++
      })
      try {
        for (let i = 0; i < 1000; i++) receive!(event('import', 'lsp.diagnostics', report(`file://${i}.java`, 1)))
        expect(changes).toBe(0)
        vi.advanceTimersByTime(50)
        expect(changes).toBe(1)
        expect(Object.keys(useCodeStudioLspStore.getState().diagnostics.import)).toHaveLength(1000)
        receive!(event('import', 'lsp.diagnostics', { ...report('file://0.java', 1), diagnostics: [] }))
        vi.advanceTimersByTime(50)
        expect(useCodeStudioLspStore.getState().diagnostics.import['file://0.java']).toBeUndefined()
      } finally { stop() }
    } finally { vi.useRealTimers() }
  })

  it('starts gopls in low resources while respecting explicit user stops', async () => {
    const original = useCodeStudioLspStore.getState()
    const sessions = useCodeStudioStore.getState().sessions
    const start = vi.fn(async () => undefined)
    useCodeStudioStore.setState({ sessions: [{ id: 'low', project: { authorization: 'tooling-permitted' } } as never] })
    useCodeStudioLspStore.setState({ start, preferences: { ...original.preferences, resourceMode: 'low' }, userStopped: {}, gopls: { low: { available: true } as never }, linter: { low: null } })
    vi.mocked(getLanguageServerStatus).mockResolvedValue({ state: 'stopped' } as never)
    try {
      await useCodeStudioLspStore.getState().ensureStarted('low')
      expect(start).toHaveBeenCalledWith('low', false)
      start.mockClear()
      useCodeStudioLspStore.setState({ userStopped: { low: true } })
      await useCodeStudioLspStore.getState().ensureStarted('low')
      expect(start).not.toHaveBeenCalled()
    } finally {
      useCodeStudioStore.setState({ sessions })
      useCodeStudioLspStore.setState({ start: original.start, preferences: original.preferences, userStopped: original.userStopped, gopls: original.gopls, linter: original.linter })
    }
  })

  it('shows activity while gopls restarts and clears it when ready', async () => {
    vi.mocked(restartLanguageServer).mockResolvedValue({ state: 'ready' } as never)
    const promise = useCodeStudioLspStore.getState().restart('a')
    expect(useCodeStudioLspStore.getState().activity.a?.label).toContain('Restarting')
    await promise
    expect(useCodeStudioLspStore.getState().activity.a).toBeNull()
  })

  it('identifies gopls installations without confusing other tools', () => {
    expect(isGoplsInstall({ kind: 'install', command: 'go install golang.org/x/tools/gopls@v0.23.0' })).toBe(true)
    expect(isGoplsInstall({ kind: 'install', command: 'go install honnef.co/go/tools/cmd/staticcheck@latest' })).toBe(false)
  })

  it('routes only a completed gopls install to language-server refresh', () => {
    const original = useCodeStudioLspStore.getState()
    const refresh = vi.fn(async () => undefined)
    const detectLinter = vi.fn(async () => null)
    useCodeStudioLspStore.setState({ refreshAfterToolchainChange: refresh, detectLinter })
    try {
      const { handleEvent } = useCodeStudioLspStore.getState()
      handleEvent(event('a', 'run.finished', { kind: 'install', status: 'exited', command: 'go install honnef.co/go/tools/cmd/staticcheck@latest' }))
      handleEvent(event('a', 'run.finished', { kind: 'install', status: 'failed', command: 'go install golang.org/x/tools/gopls@latest' }))
      expect(useCodeStudioLspStore.getState().activity.a?.error).toBe(true)
      handleEvent(event('a', 'run.finished', { kind: 'install', status: 'exited', command: 'go install golang.org/x/tools/gopls@v0.23.0' }))
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(refresh).toHaveBeenCalledWith('a')
    } finally {
      useCodeStudioLspStore.setState({ refreshAfterToolchainChange: original.refreshAfterToolchainChange, detectLinter: original.detectLinter })
    }
  })

  it('restarts gopls after selecting a different Go SDK for a trusted project', async () => {
    const originalLsp = useCodeStudioLspStore.getState()
    const originalSessions = useCodeStudioStore.getState().sessions
    const detect = vi.fn(async () => ({ available: true }))
    const restart = vi.fn(async () => undefined)
    useCodeStudioStore.setState({ sessions: [{ id: 'a', project: { authorization: 'tooling-permitted' } } as never] })
    useCodeStudioLspStore.setState({ detectGopls: detect as never, restart, status: { a: { state: 'ready' } as never } })
    try {
      await useCodeStudioLspStore.getState().refreshAfterToolchainChange('a')
      expect(detect).toHaveBeenCalledWith('a')
      expect(restart).toHaveBeenCalledWith('a', false)
    } finally {
      useCodeStudioStore.setState({ sessions: originalSessions })
      useCodeStudioLspStore.setState({ detectGopls: originalLsp.detectGopls, restart: originalLsp.restart })
    }
  })

  it('keeps an error activity when gopls crashes', () => {
    useCodeStudioLspStore.getState().handleEvent(event('a', 'lsp.status', { sessionId: 'a', state: 'crashed', error: 'boom' }))
    expect(useCodeStudioLspStore.getState().activity.a?.error).toBe(true)
    expect(useCodeStudioLspStore.getState().activity.a?.detail).toBe('boom')
  })

  it('keeps diagnostics isolated per session and replaces them per file', () => {
    const { handleEvent } = useCodeStudioLspStore.getState()
    handleEvent(event('a', 'lsp.diagnostics', report('file:///a/main.go', 1)))
    handleEvent(event('b', 'lsp.diagnostics', report('file:///b/main.go', 2)))
    handleEvent(event('a', 'lsp.diagnostics', { ...report('file:///a/main.go', 1), diagnostics: [] }))
    const { diagnostics } = useCodeStudioLspStore.getState()
    expect(diagnosticCounts(diagnostics.a)).toEqual({ errors: 0, warnings: 0 })
    expect(diagnosticCounts(diagnostics.b)).toEqual({ errors: 0, warnings: 1 })
  })

  it('keeps the same state when the server republishes identical diagnostics', () => {
    const { handleEvent } = useCodeStudioLspStore.getState()
    handleEvent(event('a', 'lsp.diagnostics', report('file:///a/main.go', 1)))
    const before = useCodeStudioLspStore.getState().diagnostics
    handleEvent(event('a', 'lsp.diagnostics', { ...report('file:///a/main.go', 1), version: 9 }))
    expect(useCodeStudioLspStore.getState().diagnostics).toBe(before)
    handleEvent(event('a', 'lsp.diagnostics', report('file:///a/main.go', 2)))
    expect(useCodeStudioLspStore.getState().diagnostics).not.toBe(before)
  })

  it('clears diagnostics and progress when gopls stops or crashes', () => {
    const { handleEvent } = useCodeStudioLspStore.getState()
    handleEvent(event('a', 'lsp.diagnostics', report('file:///a/main.go', 1)))
    handleEvent(event('a', 'lsp.progress', { token: '1', kind: 'begin', title: 'Loading packages' }))
    expect(useCodeStudioLspStore.getState().progress.a?.title).toBe('Loading packages')
    handleEvent(event('a', 'lsp.status', { sessionId: 'a', state: 'crashed', restarts: 1 }))
    expect(useCodeStudioLspStore.getState().diagnostics.a).toEqual({})
    expect(useCodeStudioLspStore.getState().progress.a).toBeNull()
  })
})

describe('exclusive IDE tool navigation', () => {
  it('replaces service logs with Git without affecting another session', () => {
    const previous = useCodeStudioStore.getState()
    const key = toolKey('active', 'logs')
    const other = toolKey('other', 'logs')
    useCodeStudioStore.setState({ activeSessionId: 'active' })
    useStudioTools.setState({ views: { [key]: { open: true }, [other]: { open: true } } })
    try {
      useCodeStudioLspStore.getState().showToolWindow('git')
      expect(useStudioTools.getState().views[key].open).toBe(false)
      expect(useStudioTools.getState().views[other].open).toBe(true)
      expect(useCodeStudioLspStore.getState().toolWindow).toBe('git')
      expect(useCodeStudioStore.getState().layout.bottomOpen).toBe(true)
    } finally {
      useCodeStudioStore.setState({ activeSessionId: previous.activeSessionId, layout: previous.layout })
      useStudioTools.setState({ views: {} })
    }
  })
})

it('protects explicit server starts but not automatic ensure starts', async () => {
  vi.mocked(startLanguageServer).mockResolvedValue({ sessionId: 'idle', state: 'ready', pid: 1 } as never)
  vi.mocked(startLanguageServer).mockClear()
  await useCodeStudioLspStore.getState().start('idle', false)
  expect(startLanguageServer).toHaveBeenLastCalledWith("idle", expect.anything(), false)
  await useCodeStudioLspStore.getState().start('idle')
  expect(startLanguageServer).toHaveBeenLastCalledWith("idle", expect.anything(), true)
})
