import { beforeEach, describe, expect, it, vi } from 'vitest'

const location = vi.hoisted(() => {
  const state = { search: '' }
  const storage = new Map<string, string>()
  const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value), removeItem: (key: string) => void storage.delete(key) }
  Object.assign(globalThis, {
    window: { location: state, requestAnimationFrame: () => 0, dispatchEvent: () => true, addEventListener: () => undefined, localStorage },
    document: { dispatchEvent: () => true },
    localStorage,
    sessionStorage: localStorage,
  })
  return state
})
const runtime = vi.hoisted(() => ({ emit: vi.fn(), on: vi.fn() }))
const bindings = vi.hoisted(() => ({ focusMain: vi.fn(), focusPanel: vi.fn(), list: vi.fn() }))
const tabs = vi.hoisted(() => ({ openTab: vi.fn() }))
const collections = vi.hoisted(() => ({ importCollection: vi.fn() }))

vi.mock('@wailsio/runtime', () => ({ Events: { Emit: runtime.emit, On: runtime.on } }))
vi.mock('../../bindings/adomnia/app', () => ({
  FocusMainWindow: bindings.focusMain,
  FocusPanelWindow: bindings.focusPanel,
  ListPanelWindows: bindings.list,
  OpenPanelWindow: vi.fn(),
  ClosePanelWindow: vi.fn(),
}))
vi.mock('@/stores/tabs', () => ({ useTabsStore: { getState: () => tabs } }))
vi.mock('@/stores/collections', () => ({ useCollectionsStore: { getState: () => collections } }))
vi.mock('@/stores/environments', () => ({ useEnvironmentsStore: { getState: () => ({ load: vi.fn() }) } }))
vi.mock('@/stores/hosts', () => ({ useHostsStore: { getState: () => ({ load: vi.fn() }) } }))

const { routeToModule, showModule } = await import('./moduleRouting')
const { usePanelWindowsStore } = await import('@/stores/panelWindows')
const { useAppStore } = await import('@/stores/app')

const request = { id: 'r1', name: 'GET /users', method: 'GET', url: '/users' } as never

function atUrl(search: string) {
  location.search = search
}

describe('module routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bindings.list.mockResolvedValue([])
    atUrl('')
    usePanelWindowsStore.setState({ detached: [], started: true })
  })

  it('runs in the main window when the module is not detached', () => {
    showModule('collections', { kind: 'open-request', request })
    expect(tabs.openTab).toHaveBeenCalledWith(request)
    expect(useAppStore.getState().activeRail).toBe('collections')
    expect(runtime.emit).not.toHaveBeenCalled()
  })

  it('sends the action to the module window and brings it forward', () => {
    usePanelWindowsStore.setState({ detached: ['collections'] })
    showModule('collections', { kind: 'open-request', request })
    expect(tabs.openTab).not.toHaveBeenCalled()
    expect(runtime.emit).toHaveBeenCalledWith('panelwindow:module-action', expect.objectContaining({ target: 'collections', rail: 'collections' }))
    expect(bindings.focusPanel).toHaveBeenCalledWith('collections')
  })

  it('from a Go Studio project window, sends to the main window', () => {
    atUrl('?window=go-studio&session=s1&windowId=go-studio-s1')
    showModule('database', { kind: 'handoff', key: 'k', value: 1 })
    expect(runtime.emit).toHaveBeenCalledWith('panelwindow:module-action', expect.objectContaining({ target: 'main', rail: 'database' }))
    expect(bindings.focusMain).toHaveBeenCalled()
  })

  it('imports without switching windows when reveal is false', () => {
    usePanelWindowsStore.setState({ detached: ['collections'] })
    routeToModule('collections', { kind: 'import-collections', collections: [] }, { reveal: false })
    expect(runtime.emit).toHaveBeenCalledWith('panelwindow:module-action', expect.objectContaining({ reveal: false }))
    expect(bindings.focusPanel).not.toHaveBeenCalled()
  })

  it('a module window runs its own module and forwards the others', () => {
    atUrl('?window=panel&panel=collections')
    showModule('collections', { kind: 'open-request', request })
    expect(tabs.openTab).toHaveBeenCalled()
    showModule('mock', { kind: 'event', name: 'x' })
    expect(runtime.emit).toHaveBeenCalledWith('panelwindow:module-action', expect.objectContaining({ target: 'main', rail: 'mock' }))
  })
})
