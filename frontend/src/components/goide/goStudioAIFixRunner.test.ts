import { beforeEach, describe, expect, it, vi } from 'vitest'

const ai = vi.hoisted(() => ({ complete: vi.fn(), configure: vi.fn(() => Promise.resolve()), available: true }))
const api = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn(), close: vi.fn(() => Promise.resolve()) }))
const goide = vi.hoisted(() => ({
  state: {
    activeSessionId: 's1',
    sessions: [{ id: 's1', project: { modules: [{ path: '.', modulePath: 'Example' }] } }],
    documents: [] as unknown[],
    ensureDocumentLoaded: vi.fn(),
  },
}))
const lsp = vi.hoisted(() => ({ setState: vi.fn() }))

vi.mock('../../../bindings/adomnia/aiengine', () => ({ Complete: ai.complete }))
vi.mock('@/lib/aiEngine', () => ({ ensureAIConfigured: ai.configure }))
vi.mock('@/lib/aiAvailability', () => ({ isAICompanionAvailable: () => ai.available }))
vi.mock('@/stores/settings', () => ({ useSettingsStore: { getState: () => ({ settings: { ai: { provider: 'anthropic' } } }) } }))
vi.mock('@/lib/goide-api', () => ({ listGoIDEDirectory: api.list, openGoIDEDocument: api.open, closeGoIDEDocument: api.close }))
vi.mock('@/lib/goide-lsp-api', () => ({}))
vi.mock('@/lib/monacoSetup', () => ({ monaco: {} }))
vi.mock('@/stores/goide', () => ({ useGoIDEStore: { getState: () => goide.state } }))
vi.mock('@/stores/goideLsp', () => ({ useGoIDELspStore: { setState: lsp.setState } }))

import { fixGoStudioProblemWithAI } from './goStudioAIFixRunner'

const callerSource = 'package files\n\nimport (\n\t"Example/logger"\n)\n\nvar loggerInstance = logger.GetLoggerInstance()\n'
const loggerSource = 'package logger\n\nfunc Info(v ...interface{}) {}\n'
const problem = { message: 'undefined: logger.GetLoggerInstance', line: 7, source: 'compiler' }

function lastState(): Record<string, unknown> {
  return lsp.setState.mock.calls[lsp.setState.mock.calls.length - 1]?.[0] ?? {}
}

describe('Fix with AI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ai.available = true
    goide.state.ensureDocumentLoaded.mockResolvedValue({ buffer: callerSource, document: { id: 'd1', uri: 'file:///p/files/a.go', path: '/p/files/a.go', relativePath: 'files/a.go' } })
    api.list.mockResolvedValue([
      { name: 'Logger.go', relativePath: 'logger/Logger.go', directory: false },
      { name: 'Logger_test.go', relativePath: 'logger/Logger_test.go', directory: false },
    ])
    api.open.mockResolvedValue({ content: loggerSource, document: { id: 'd2', uri: 'file:///p/logger/Logger.go', path: '/p/logger/Logger.go' } })
  })

  it('asks the configured AI with the file and the local package, then opens the preview', async () => {
    ai.complete.mockResolvedValue('=== FILE: logger/Logger.go ===\npackage logger\n\nfunc Info(v ...interface{}) {}\n\nfunc GetLoggerInstance() *Logger { return nil }\n=== END FILE ===')
    await fixGoStudioProblemWithAI('files/a.go', problem)
    const [system, user] = ai.complete.mock.calls[0]
    expect(system).toContain('=== FILE:')
    expect(user).toContain('undefined: logger.GetLoggerInstance')
    expect(user).toContain('=== FILE: logger/Logger.go ===')
    expect(user).not.toContain('Logger_test.go')
    expect(api.close).toHaveBeenCalledWith('s1', 'd2')
    const change = (lastState().pendingChange as { label: string; files: Array<{ relativePath: string; edits: unknown[]; newContent: string }> })
    expect(change.label).toContain('Fix with AI')
    expect(change.files).toHaveLength(1)
    expect(change.files[0].relativePath).toBe('logger/Logger.go')
    expect(change.files[0].newContent).toContain('func GetLoggerInstance()')
    expect(change.files[0].edits).toHaveLength(1)
  })

  it('never applies anything when the answer has no usable file', async () => {
    ai.complete.mockResolvedValue('Sorry, I cannot see the problem.')
    await fixGoStudioProblemWithAI('files/a.go', problem)
    expect(lastState().pendingChange).toBeUndefined()
    expect(String(lastState().message)).toContain('did not propose')
  })

  it('reports provider errors instead of failing silently', async () => {
    ai.complete.mockRejectedValue(new Error('401 invalid API key'))
    await fixGoStudioProblemWithAI('files/a.go', problem)
    expect(String(lastState().message)).toContain('401 invalid API key')
  })

  it('explains how to enable it when no AI provider is configured', async () => {
    ai.available = false
    await fixGoStudioProblemWithAI('files/a.go', problem)
    expect(ai.complete).not.toHaveBeenCalled()
    expect(String(lastState().message)).toContain('Settings → AI')
  })
})
