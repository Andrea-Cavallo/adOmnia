import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const assistant = () => {
    const state = { settings: { enabled: true }, error: null, ensure: vi.fn(), setEnabled: vi.fn() }
    state.setEnabled.mockImplementation(async (enabled: boolean) => { state.settings.enabled = enabled; return true })
    return { getState: () => state }
  }
  const agents = [assistant(), assistant(), assistant(), assistant()]
  const lsp = {
    preferences: { resourceMode: 'normal' }, settings: { staticcheck: true, vulncheck: false },
    status: { s1: { state: 'ready' } }, activity: {}, userStopped: {},
    updatePreferences: vi.fn(), updateSettings: vi.fn(), cancelLint: vi.fn(), restart: vi.fn(), ensureStarted: vi.fn(),
  }
  return { agents, lsp, app: { sessions: [{ id: 's1', project: { name: 'demo' } }], executions: [{ id: 'running', status: 'running' }] }, setApp: vi.fn(), toast: vi.fn() }
})
vi.mock('./copilot', () => ({ useCopilotStore: mocks.agents[0] }))
vi.mock('./milk', () => ({ useMilkStore: mocks.agents[1] }))
vi.mock('./claudeCode', () => ({ useClaudeCodeStore: mocks.agents[2] }))
vi.mock('./opencode', () => ({ useOpenCodeStore: mocks.agents[3] }))
vi.mock('./codeStudio', () => ({ useCodeStudioStore: { getState: () => mocks.app, setState: mocks.setApp } }))
vi.mock('./codeStudioLsp', () => ({ useCodeStudioLspStore: { getState: () => mocks.lsp, setState: vi.fn() } }))
vi.mock('./ideLanguageServers', () => ({ useIdeLanguageServersStore: { getState: () => ({ servers: {} }) } }))
vi.mock('./codeStudioToast', () => ({ studioToast: mocks.toast }))
import { useCodeStudioLowResources } from './codeStudioLowResources'

beforeEach(() => {
  vi.clearAllMocks()
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
  mocks.lsp.preferences.resourceMode = 'normal'
  mocks.lsp.settings = { staticcheck: true, vulncheck: false }
  mocks.lsp.updatePreferences.mockImplementation(patch => Object.assign(mocks.lsp.preferences, patch))
  mocks.lsp.updateSettings.mockImplementation(async (_id, patch) => Object.assign(mocks.lsp.settings, patch))
  for (const agent of mocks.agents) {
    agent.getState().settings.enabled = true
    agent.getState().setEnabled.mockImplementation(async enabled => { agent.getState().settings.enabled = enabled; return true })
  }
  mocks.agents[3].getState().settings.enabled = false
  useCodeStudioLowResources.setState({ busy: false, restore: null, error: null })
})

describe('reversible low resources', () => {
  it('keeps the IDE usable and restores only the assistants that were enabled', async () => {
    await useCodeStudioLowResources.getState().toggle()
    expect(mocks.lsp.preferences.resourceMode).toBe('low')
    expect(mocks.lsp.settings.staticcheck).toBe(false)
    expect(mocks.lsp.restart).toHaveBeenCalledWith('s1', false)
    expect(mocks.app.executions[0].status).toBe('running')
    expect(mocks.agents[0].getState().settings.enabled).toBe(false)
    expect(mocks.agents[3].getState().setEnabled).not.toHaveBeenCalled()
    await useCodeStudioLowResources.getState().toggle()
    expect(mocks.lsp.preferences.resourceMode).toBe('normal')
    expect(mocks.lsp.settings.staticcheck).toBe(true)
    expect(mocks.agents[0].getState().settings.enabled).toBe(true)
    expect(mocks.agents[3].getState().settings.enabled).toBe(false)
    expect(useCodeStudioLowResources.getState().restore).toBeNull()
  })
  it('retains the restore snapshot after a failure and retries even after returning to normal mode', async () => {
    await useCodeStudioLowResources.getState().activate()
    mocks.agents[1].getState().setEnabled.mockResolvedValueOnce(false)
    await useCodeStudioLowResources.getState().deactivate()
    expect(useCodeStudioLowResources.getState().error).toContain('milk')
    expect(useCodeStudioLowResources.getState().restore).not.toBeNull()
    expect(mocks.agents[0].getState().settings.enabled).toBe(true)
    await useCodeStudioLowResources.getState().toggle()
    expect(mocks.agents[1].getState().settings.enabled).toBe(true)
    expect(useCodeStudioLowResources.getState().restore).toBeNull()
  })
  it('does not suspend anything if recovery flags cannot be saved', async () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('Storage full') } })
    await useCodeStudioLowResources.getState().activate()
    expect(useCodeStudioLowResources.getState().error).toContain('Storage full')
    expect(mocks.agents[0].getState().setEnabled).not.toHaveBeenCalled()
    expect(mocks.lsp.preferences.resourceMode).toBe('normal')
  })
  it('does not restart gopls when no optional analyses changed', async () => {
    mocks.lsp.settings.staticcheck = false
    await useCodeStudioLowResources.getState().activate()
    await useCodeStudioLowResources.getState().deactivate()
    expect(mocks.lsp.restart).not.toHaveBeenCalled()
    expect(mocks.lsp.ensureStarted).not.toHaveBeenCalled()
  })
  it('persists only recovery flags, so restoration survives a module reload', async () => {
    await useCodeStudioLowResources.getState().activate()
    vi.resetModules()
    const { useCodeStudioLowResources: reloaded } = await import('./codeStudioLowResources')
    expect(reloaded.getState().restore?.agents.Copilot).toBe(true)
    await reloaded.getState().toggle()
    expect(mocks.agents[0].getState().settings.enabled).toBe(true)
    expect(reloaded.getState().restore).toBeNull()
  })
})
