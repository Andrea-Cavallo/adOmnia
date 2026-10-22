import { beforeAll, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({
  handlers: new Map<string, (event: { data: unknown }) => void>(),
  emit: vi.fn(async (_name: string, _data: unknown) => undefined),
  stop: vi.fn(async () => undefined),
  sendChat: vi.fn(() => new Promise<void>(() => { /* Deliberately still streaming. */ })),
}))
vi.mock('@wailsio/runtime', () => ({ Events: {
  On: (name: string, handler: (event: { data: unknown }) => void) => { transport.handlers.set(name, handler); return () => undefined },
  Emit: transport.emit,
} }))
vi.mock('../../../bindings/adomnia/app', () => ({
  ListPanelWindows: async () => ['tool-session-1-run', 'tool-session-1-milk'],
  FocusMainWindow: vi.fn(), CloseStudioToolWindow: vi.fn(),
}))
vi.mock('@/lib/code-studio-api', () => ({ subscribeGoIDEEvents: () => () => undefined, listGoIDETerminals: async () => [] }))
vi.mock('@/lib/code-studio-window-api', () => ({ focusGoIDESessionWindow: vi.fn() }))
vi.mock('@/stores/codeStudio', async () => {
  const { create } = await import('zustand')
  return { useCodeStudioStore: create(() => ({
    sessions: [{ id: 'session-1', project: { realPath: '/project' } }], documents: [],
    activeDocumentBySession: {}, executions: [{ id: 'run-1', sessionId: 'session-1' }],
    activeRunBySession: {}, consoleByRun: {}, stopRun: transport.stop,
  })) }
})
vi.mock('@/stores/codeStudioWindows', async () => {
  const { create } = await import('zustand')
  return { useCodeStudioWindowsStore: create(() => ({ ownsSession: (id: string) => id === 'session-1', context: { windowId: 'main' } })) }
})
vi.mock('@/stores/milk', async () => {
  const { create } = await import('zustand')
  return { useMilkStore: create(() => ({ status: null, settings: null, chatThreads: {}, permissions: [], sendChat: transport.sendChat })) }
})
vi.mock('@/stores/claudeCode', async () => {
  const { create } = await import('zustand')
  return { useClaudeCodeStore: create(() => ({ status: null, settings: null, chatThreads: {}, permissions: [] })) }
})
vi.mock('@/stores/copilot', async () => {
  const { create } = await import('zustand')
  return { useCopilotStore: create(() => ({ status: null, settings: null, chatThreads: {}, chatModels: [] })) }
})
vi.mock('@/stores/codeStudioLsp', async () => {
  const { create } = await import('zustand')
  return { useCodeStudioLspStore: create(() => ({ terminalRequest: null })) }
})
vi.mock('@/stores/codeStudioTests', async () => {
  const { create } = await import('zustand')
  return { useCodeStudioTestsStore: create(() => ({})) }
})
vi.mock('@/stores/app', async () => {
  const { create } = await import('zustand')
  return { useAppStore: create(() => ({})) }
})

import { startStudioToolOwner } from './studioToolBridge'
import { useStudioTools } from './studioToolState'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'

beforeAll(async () => {
  startStudioToolOwner()
  await vi.waitFor(() => expect(useStudioTools.getState().detached).toContain('tool-session-1-run'))
})
describe('tool owner routing', () => {
  it('runs commands only for runs owned by the selected project', async () => {
    transport.handlers.get('studio-tool:request')?.({ data: { session: 'session-1', tool: 'run', id: 'invalid', action: 'stopRun', args: ['another-project-run'] } })
    await vi.waitFor(() => expect(transport.emit).toHaveBeenCalledWith('studio-tool:response', expect.objectContaining({ id: 'invalid', error: expect.stringContaining('another project') })))
    expect(transport.stop).not.toHaveBeenCalled()
    transport.handlers.get('studio-tool:request')?.({ data: { session: 'session-1', tool: 'run', id: 'valid', action: 'stopRun', args: ['run-1'] } })
    await vi.waitFor(() => expect(transport.stop).toHaveBeenCalledWith('run-1'))
  })
  it('ignores commands addressed to another project window', () => {
    transport.emit.mockClear()
    transport.handlers.get('studio-tool:request')?.({ data: { session: 'session-2', tool: 'run', id: 'wrong-owner', action: 'stopRun', args: ['run-1'] } })
    expect(transport.emit).not.toHaveBeenCalled()
  })
  it('acknowledges chat submission while its response continues streaming in the owner', async () => {
    transport.handlers.get('studio-tool:request')?.({ data: { session: 'session-1', tool: 'milk', id: 'chat', action: 'sendChat', args: ['/ignored-client-root', 'hello'] } })
    await vi.waitFor(() => expect(transport.emit).toHaveBeenCalledWith('studio-tool:response', expect.objectContaining({ id: 'chat', result: null })))
    expect(transport.sendChat).toHaveBeenCalledWith('/project', 'hello', undefined)
  })
  it('sends active document updates to the detached milk window', async () => {
    const document = { document: { id: 'editor-1', sessionId: 'session-1', relativePath: 'Current.java' }, buffer: 'class Current {}' } as GoIDEEditorDocument
    useCodeStudioStore.setState({ documents: [document], activeDocumentBySession: { 'session-1': 'editor-1' } })
    await vi.waitFor(() => expect(transport.emit).toHaveBeenCalledWith('studio-tool:snapshot', expect.objectContaining({ key: 'tool-session-1-milk', document })))
  })
  it('forwards detached milk attachment switches to the project owner', async () => {
    const context = { includeDocument: false, includeWorkspace: true }
    transport.handlers.get('studio-tool:request')?.({ data: { session: 'session-1', tool: 'milk', id: 'context', action: 'sendChat', args: ['/ignored', 'read', context] } })
    await vi.waitFor(() => expect(transport.sendChat).toHaveBeenCalledWith('/project', 'read', context))
  })
})
