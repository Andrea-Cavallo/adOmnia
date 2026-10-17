import { beforeEach, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ milk: vi.fn(async () => ({})), copilot: vi.fn(async () => ({ conversationId: 'c', turnId: 't' })), policy: 'allowed', rules: [] as { path: string; text: string }[] }))
vi.mock('@/lib/milk-api', () => ({ sendMilkPrompt: transport.milk }))
vi.mock('@/lib/copilot-api', () => ({ sendCopilotChat: transport.copilot }))
vi.mock('@/stores/codeStudioLsp', () => ({ useCodeStudioLspStore: { getState: () => ({}) } }))
vi.mock('@/lib/code-studio-api', () => ({
  getGoIDEAIPolicy: async () => transport.policy,
  getGoIDEProjectRules: async () => transport.rules,
  listGoIDEAIExcludedPaths: async () => [],
  quickOpenGoIDEFiles: async () => [{ relativePath: 'src/Other.java' }],
}))
vi.mock('@/stores/codeStudio', () => ({ useCodeStudioStore: { getState: () => ({
  sessions: [{ id: 's', project: { name: 'Project', realPath: '/p' } }],
  activeDocumentBySession: { s: 'd' }, directoryEntries: {},
  documents: [{ document: { id: 'd', sessionId: 's', relativePath: 'src/Current.java' }, buffer: 'class Current { /* unsaved */ }', dirty: true }],
}) } }))
import { useMilkStore } from './milk'
import { useCopilotStore } from './copilot'

beforeEach(() => {
  transport.rules = []
  transport.policy = 'allowed'
  transport.milk.mockClear()
  transport.copilot.mockClear()
  useMilkStore.setState({ chatThreads: {} })
  useCopilotStore.setState({ chatThreads: {} })
})

describe('both chat transports attach the actual editor buffer', () => {
  it('sends milk the current class while displaying only the original user question', async () => {
    await useMilkStore.getState().sendChat('/p', 'Leggi la classe aperta')
    expect(transport.milk).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('class Current { /* unsaved */ }') }))
    expect(useMilkStore.getState().chatThreads['/p'].messages[0]).toMatchObject({ content: 'Leggi la classe aperta', context: ['src/Current.java (unsaved)', 'Project'] })
  })
  it('sends Copilot source even without a document already tracked by its language server', async () => {
    await useCopilotStore.getState().sendChat('/p', 'Leggi la classe aperta', { includeDocument: true, includeWorkspace: true, labels: [] })
    expect(transport.copilot).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('class Current { /* unsaved */ }'), includeDocument: false, selection: null }))
  })
  it('never calls either provider when project policy blocks the context', async () => {
    transport.policy = 'off'
    await useMilkStore.getState().sendChat('/p', 'Read')
    await useCopilotStore.getState().sendChat('/p', 'Read', { includeDocument: true, includeWorkspace: true, labels: [] })
    expect(transport.milk).not.toHaveBeenCalled()
    expect(transport.copilot).not.toHaveBeenCalled()
    expect(useMilkStore.getState().chatThreads['/p'].error).toContain('turned off')
  })
})

it('adds project rules to both agent and Copilot transports by default', async () => {
  transport.rules = [{ path: '.rules', text: 'Prefer local storage.' }]
  await useMilkStore.getState().sendChat('/p', 'Question')
  expect(transport.milk).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Prefer local storage.') }))
  await useCopilotStore.getState().sendChat('/p', 'Question', { includeDocument: false, includeWorkspace: false, labels: [] })
  expect(transport.copilot).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Prefer local storage.') }))
})
