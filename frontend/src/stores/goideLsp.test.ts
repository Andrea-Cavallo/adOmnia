import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('@/lib/goide-lsp-api', () => ({
  detectGopls: vi.fn(), installGopls: vi.fn(), restartLanguageServer: vi.fn(), startLanguageServer: vi.fn(),
  stopLanguageServer: vi.fn(), getLanguageServerStatus: vi.fn(), openExternalDocument: vi.fn(),
}))

import { diagnosticCounts, useGoIDELspStore } from './goideLsp'
import { restartLanguageServer } from '@/lib/goide-lsp-api'

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
