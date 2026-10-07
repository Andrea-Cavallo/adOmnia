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
vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: () => () => undefined, listGoIDETerminals: async () => [] }))
vi.mock('@/lib/goide-window-api', () => ({ focusGoIDESessionWindow: vi.fn() }))
vi.mock('@/stores/goide', async () => {
  const { create } = await import('zustand')
  return { useGoIDEStore: create(() => ({
    sessions: [{ id: 'session-1', project: { realPath: '/project' } }], documents: [],
    activeDocumentBySession: {}, executions: [{ id: 'run-1', sessionId: 'session-1' }],
    activeRunBySession: {}, consoleByRun: {}, stopRun: transport.stop,
  })) }
})
vi.mock('@/stores/goideWindows', async () => {
  const { create } = await import('zustand')
  return { useGoIDEWindowsStore: create(() => ({ ownsSession: (id: string) => id === 'session-1', context: { windowId: 'main' } })) }
})
vi.mock('@/stores/milk', async () => {
  const { create } = await import('zustand')
  return { useMilkStore: create(() => ({ status: null, settings: null, chatThreads: {}, permissions: [], sendChat: transport.sendChat })) }
})
vi.mock('@/stores/copilot', async () => {
  const { create } = await import('zustand')
  return { useCopilotStore: create(() => ({ status: null, settings: null, chatThreads: {}, chatModels: [] })) }
})
vi.mock('@/stores/goideLsp', async () => {
  const { create } = await import('zustand')
  return { useGoIDELspStore: create(() => ({ terminalRequest: null })) }
})
vi.mock('@/stores/goideTests', async () => {
  const { create } = await import('zustand')
  return { useGoIDETestsStore: create(() => ({})) }
})
vi.mock('@/stores/app', async () => {
  const { create } = await import('zustand')
  return { useAppStore: create(() => ({})) }
})

import { startStudioToolOwner } from './studioToolBridge'
import { useStudioTools } from './studioToolState'

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
    expect(transport.sendChat).toHaveBeenCalledWith('/project', 'hello')
  })
})
