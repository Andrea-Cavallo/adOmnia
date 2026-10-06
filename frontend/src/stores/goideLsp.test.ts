import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('@/lib/goide-lsp-api', () => ({
  detectGopls: vi.fn(), installGopls: vi.fn(), restartLanguageServer: vi.fn(), startLanguageServer: vi.fn(),
  stopLanguageServer: vi.fn(), getLanguageServerStatus: vi.fn(), openExternalDocument: vi.fn(),
}))

import { diagnosticCounts, isGoplsInstall, useGoIDELspStore } from './goideLsp'
import { restartLanguageServer } from '@/lib/goide-lsp-api'
import { useGoIDEStore } from './goide'

const report = (uri: string, severity: number) => ({
  uri, path: uri.replace('file://', ''), relativePath: 'main.go',
  diagnostics: [{ range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }, severity, message: 'x' }],
})

const event = (sessionId: string, type: string, payload: unknown) => ({ version: 1, type, sessionId, sequence: 1, timestamp: '', payload })

describe('Go Studio language server store', () => {
  beforeEach(() => useGoIDELspStore.setState({ diagnostics: {}, status: {}, progress: {}, activity: {} }))

  it('shows activity while gopls restarts and clears it when ready', async () => {
    vi.mocked(restartLanguageServer).mockResolvedValue({ state: 'ready' } as never)
    const promise = useGoIDELspStore.getState().restart('a')
    expect(useGoIDELspStore.getState().activity.a?.label).toContain('Restarting')
    await promise
    expect(useGoIDELspStore.getState().activity.a).toBeNull()
  })

  it('identifies gopls installations without confusing other tools', () => {
    expect(isGoplsInstall({ kind: 'install', command: 'go install golang.org/x/tools/gopls@v0.23.0' })).toBe(true)
    expect(isGoplsInstall({ kind: 'install', command: 'go install honnef.co/go/tools/cmd/staticcheck@latest' })).toBe(false)
  })

  it('routes only a completed gopls install to language-server refresh', () => {
    const original = useGoIDELspStore.getState()
    const refresh = vi.fn(async () => undefined)
    const detectLinter = vi.fn(async () => null)
    useGoIDELspStore.setState({ refreshAfterToolchainChange: refresh, detectLinter })
    try {
      const { handleEvent } = useGoIDELspStore.getState()
      handleEvent(event('a', 'run.finished', { kind: 'install', status: 'exited', command: 'go install honnef.co/go/tools/cmd/staticcheck@latest' }))
      handleEvent(event('a', 'run.finished', { kind: 'install', status: 'failed', command: 'go install golang.org/x/tools/gopls@latest' }))
      expect(useGoIDELspStore.getState().activity.a?.error).toBe(true)
      handleEvent(event('a', 'run.finished', { kind: 'install', status: 'exited', command: 'go install golang.org/x/tools/gopls@v0.23.0' }))
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(refresh).toHaveBeenCalledWith('a')
    } finally {
      useGoIDELspStore.setState({ refreshAfterToolchainChange: original.refreshAfterToolchainChange, detectLinter: original.detectLinter })
    }
  })

  it('restarts gopls after selecting a different Go SDK for a trusted project', async () => {
    const originalLsp = useGoIDELspStore.getState()
    const originalSessions = useGoIDEStore.getState().sessions
    const detect = vi.fn(async () => ({ available: true }))
    const restart = vi.fn(async () => undefined)
    useGoIDEStore.setState({ sessions: [{ id: 'a', project: { authorization: 'tooling-permitted' } } as never] })
    useGoIDELspStore.setState({ detectGopls: detect as never, restart, status: { a: { state: 'ready' } as never } })
    try {
      await useGoIDELspStore.getState().refreshAfterToolchainChange('a')
      expect(detect).toHaveBeenCalledWith('a')
      expect(restart).toHaveBeenCalledWith('a')
    } finally {
      useGoIDEStore.setState({ sessions: originalSessions })
      useGoIDELspStore.setState({ detectGopls: originalLsp.detectGopls, restart: originalLsp.restart })
    }
  })

  it('keeps an error activity when gopls crashes', () => {
    useGoIDELspStore.getState().handleEvent(event('a', 'lsp.status', { sessionId: 'a', state: 'crashed', error: 'boom' }))
    expect(useGoIDELspStore.getState().activity.a?.error).toBe(true)
    expect(useGoIDELspStore.getState().activity.a?.detail).toBe('boom')
  })

  it('keeps diagnostics isolated per session and replaces them per file', () => {
    const { handleEvent } = useGoIDELspStore.getState()
    handleEvent(event('a', 'lsp.diagnostics', report('file:///a/main.go', 1)))
    handleEvent(event('b', 'lsp.diagnostics', report('file:///b/main.go', 2)))
    handleEvent(event('a', 'lsp.diagnostics', { ...report('file:///a/main.go', 1), diagnostics: [] }))
    const { diagnostics } = useGoIDELspStore.getState()
    expect(diagnosticCounts(diagnostics.a)).toEqual({ errors: 0, warnings: 0 })
    expect(diagnosticCounts(diagnostics.b)).toEqual({ errors: 0, warnings: 1 })
  })

  it('clears diagnostics and progress when gopls stops or crashes', () => {
    const { handleEvent } = useGoIDELspStore.getState()
    handleEvent(event('a', 'lsp.diagnostics', report('file:///a/main.go', 1)))
    handleEvent(event('a', 'lsp.progress', { token: '1', kind: 'begin', title: 'Loading packages' }))
    expect(useGoIDELspStore.getState().progress.a?.title).toBe('Loading packages')
    handleEvent(event('a', 'lsp.status', { sessionId: 'a', state: 'crashed', restarts: 1 }))
    expect(useGoIDELspStore.getState().diagnostics.a).toEqual({})
    expect(useGoIDELspStore.getState().progress.a).toBeNull()
  })
})
