import { beforeEach, describe, expect, it, vi } from 'vitest'

const ai = vi.hoisted(() => ({ complete: vi.fn(), configure: vi.fn(() => Promise.resolve()), available: true }))
const api = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn(), close: vi.fn(() => Promise.resolve()), excluded: vi.fn(() => Promise.resolve([] as string[])) }))
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
vi.mock('@/lib/goide-api', () => ({ listGoIDEDirectory: api.list, openGoIDEDocument: api.open, closeGoIDEDocument: api.close, listGoIDEAIExcludedPaths: api.excluded, getGoIDEAIPolicy: async () => 'allowed', isLocalAIProvider: () => false }))
vi.mock('@/lib/goide-lsp-api', () => ({}))
vi.mock('@/lib/monacoSetup', () => ({ monaco: {} }))
vi.mock('@/stores/goide', () => ({ useGoIDEStore: { getState: () => goide.state } }))
vi.mock('@/stores/goideLsp', () => ({ useGoIDELspStore: { setState: lsp.setState } }))

import { fixGoStudioProblemWithAI, resolveAllGoStudioProblemsWithAI } from './goStudioAIFixRunner'

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

  it('never sends files excluded by .adomnia/aiignore', async () => {
    api.excluded.mockResolvedValueOnce(['logger/Logger.go'])
    ai.complete.mockResolvedValue('no change')
    await fixGoStudioProblemWithAI('files/a.go', problem)
    expect(ai.complete.mock.calls[0][1]).not.toContain('logger/Logger.go')

    api.excluded.mockResolvedValueOnce(['files/a.go'])
    ai.complete.mockClear()
    await fixGoStudioProblemWithAI('files/a.go', problem)
    expect(ai.complete).not.toHaveBeenCalled()
    expect(String(lastState().message)).toContain('aiignore')
  })

  it('redacts secrets before sending and restores them in the proposed change', async () => {
    const withSecret = 'package logger\n\nconst dbPassword = "hunter22"\n\nfunc Info(v ...interface{}) {}\n'
    api.open.mockResolvedValue({ content: withSecret, document: { id: 'd2', uri: 'file:///p/logger/Logger.go', path: '/p/logger/Logger.go' } })
    ai.complete.mockImplementation(async (_system: string, user: string) => {
      expect(user).not.toContain('hunter22')
      const placeholder = /ADOMNIA_REDACTED_\d+/.exec(user)![0]
      return `=== FILE: logger/Logger.go ===
package logger

const dbPassword = "${placeholder}"

func Info(v ...interface{}) {}

func GetLoggerInstance() {}
=== END FILE ===`
    })
    await fixGoStudioProblemWithAI('files/a.go', problem)
    const change = lastState().pendingChange as { files: Array<{ newContent: string }> }
    expect(change.files[0].newContent).toContain('const dbPassword = "hunter22"')
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

describe('Resolve all with AI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ai.available = true
    api.list.mockResolvedValue([])
    goide.state.ensureDocumentLoaded.mockImplementation(async (relativePath: string) => ({ buffer: 'package x\n\nvar a = 1\n', document: { id: relativePath, uri: `file:///p/${relativePath}`, path: `/p/${relativePath}`, relativePath } }))
  })

  it('asks once per file and shows every proposed change in a single preview', async () => {
    ai.complete.mockImplementation(async (_system: string, user: string) => {
      const path = user.includes('=== FILE: a.go ===') ? 'a.go' : 'b.go'
      return `=== FILE: ${path} ===\npackage x\n\nvar a = 2\n=== END FILE ===`
    })
    await resolveAllGoStudioProblemsWithAI([
      { relativePath: 'a.go', problems: [{ message: 'unused', line: 3 }] },
      { relativePath: 'b.go', problems: [{ message: 'shadow', line: 3 }, { message: 'other', line: 1 }] },
    ])
    expect(ai.complete).toHaveBeenCalledTimes(2)
    const change = lastState().pendingChange as { label: string; files: Array<{ relativePath: string }> }
    expect(change.label).toBe('Resolve all with AI · 2 files')
    expect(change.files.map((file) => file.relativePath)).toEqual(['a.go', 'b.go'])
  })

  it('keeps going when one file fails and reports it', async () => {
    ai.complete.mockRejectedValueOnce(new Error('rate limited')).mockResolvedValueOnce('=== FILE: b.go ===\npackage x\n\nvar a = 3\n=== END FILE ===')
    await resolveAllGoStudioProblemsWithAI([
      { relativePath: 'a.go', problems: [{ message: 'unused', line: 3 }] },
      { relativePath: 'b.go', problems: [{ message: 'shadow', line: 3 }] },
    ])
    const states = lsp.setState.mock.calls.map((call) => call[0] as Record<string, unknown>)
    expect(states.some((state) => String(state.message).includes('rate limited'))).toBe(true)
    expect((lastState().pendingChange as { files: unknown[] }).files).toHaveLength(1)
  })
})
