import { describe, expect, it, vi } from 'vitest'
import { aiProviderBadge, aiProviderPower, aiProviderTone, aiProviderTooltip, providerLabel } from './codeStudioAiHub'

describe('AI hub provider status', () => {
  it('maps every provider state to a tone: green only for ready', () => {
    expect(aiProviderTone('ready')).toBe('ready')
    expect(aiProviderTone('starting')).toBe('busy')
    expect(aiProviderTone('installing')).toBe('busy')
    expect(aiProviderTone('outdated')).toBe('busy')
    expect(aiProviderTone('warning')).toBe('busy')
    expect(aiProviderTone('error')).toBe('error')
    expect(aiProviderTone('unauthorized')).toBe('error')
    expect(aiProviderTone('not-installed')).toBe('idle')
    expect(aiProviderTone('signed-out')).toBe('idle')
    expect(aiProviderTone('disabled')).toBe('idle')
    expect(aiProviderTone('')).toBe('idle')
    expect(aiProviderTone(null)).toBe('idle')
    expect(aiProviderTone(undefined)).toBe('idle')
  })

  it('never claims readiness for an unknown state', () => {
    expect(aiProviderTone('crashed')).toBe('idle')
  })

  it('drives the stripe badge from the tone', () => {
    expect(aiProviderBadge('ready')).toBe('success')
    expect(aiProviderBadge('busy')).toBe('warning')
    expect(aiProviderBadge('error')).toBe('danger')
    expect(aiProviderBadge('idle')).toBeNull()
  })

  it('surfaces the classified GS-3 message as the tooltip', () => {
    expect(aiProviderTooltip('error', 'npm registry is unreachable behind the proxy', 'milk')).toBe(
      'milk — Not responding: npm registry is unreachable behind the proxy',
    )
    expect(aiProviderTooltip('ready', null, 'Copilot')).toBe('Copilot — Ready')
    expect(providerLabel('claude')).toBe('Claude Code')
    expect(providerLabel('milk')).toBe('milk')
  })
})

describe('AI hub last provider', () => {
  const KEY = 'adomnia.codestudio.ai.lastProvider.v1'

  const withMemoryStorage = async (initial: Record<string, string> = {}) => {
    const memory = new Map<string, string>(Object.entries(initial))
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
      clear: () => memory.clear(),
    })
    // Store nuovo a ogni test: loadLastProvider gira solo all'importazione del modulo.
    vi.resetModules()
    const store = await import('@/stores/codeStudioAssistant')
    return { memory, store }
  }

  it('remembers the chosen provider across sessions', async () => {
    const { memory, store } = await withMemoryStorage()
    store.useCodeStudioAssistantStore.getState().open('milk')
    expect(store.useCodeStudioAssistantStore.getState().lastProvider).toBe('milk')
    expect(memory.get(KEY)).toBe('milk')
  })

  it('keeps the last provider when the pane closes, so the AI button reopens it', async () => {
    const { store } = await withMemoryStorage()
    store.useCodeStudioAssistantStore.getState().open('claude')
    store.useCodeStudioAssistantStore.getState().close()
    expect(store.useCodeStudioAssistantStore.getState().pane).toBeNull()
    expect(store.useCodeStudioAssistantStore.getState().lastProvider).toBe('claude')
  })

  it('ignores non-chat panes for the remembered provider', async () => {
    const { memory, store } = await withMemoryStorage()
    store.useCodeStudioAssistantStore.getState().open('copilot')
    store.useCodeStudioAssistantStore.getState().open('a0')
    expect(store.useCodeStudioAssistantStore.getState().lastProvider).toBe('copilot')
    expect(memory.get(KEY)).toBe('copilot')
  })

  it('falls back to Copilot when the saved provider is unknown', async () => {
    const { store } = await withMemoryStorage({ [KEY]: 'teleprinter' })
    expect(store.useCodeStudioAssistantStore.getState().lastProvider).toBe('copilot')
    expect(store.DEFAULT_PROVIDER).toBe('copilot')
  })
})

describe('AI hub quick power switch', () => {
  it('names the action for the current state and stays inert until the setting is known', () => {
    expect(aiProviderPower('milk', true)).toEqual({ label: 'Turn milk off', next: false, disabled: false })
    expect(aiProviderPower('Claude Code', false)).toEqual({ label: 'Turn Claude Code on', next: true, disabled: false })
    expect(aiProviderPower('Copilot', null)).toEqual({ label: 'Copilot: loading its setting', next: true, disabled: true })
  })

  it('lets the tab show an off provider as off even when its status is idle', () => {
    expect(aiProviderTone('disabled')).toBe('idle')
    expect(aiProviderTooltip('idle', null, 'milk')).toBe('milk — Not available')
  })
})
