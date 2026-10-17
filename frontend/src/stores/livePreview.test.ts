import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWebProject: vi.fn(),
  startPreview: vi.fn(),
  stopPreview: vi.fn(),
  installWebDependencies: vi.fn(),
  savePreviewConfig: vi.fn(),
  dismissPreviews: vi.fn(),
  openPreviewWindow: vi.fn(),
  readyPreviewUrl: vi.fn(),
  showToolWindow: vi.fn(),
}))

vi.mock('@/lib/livepreview-api', () => ({
  detectWebProject: mocks.detectWebProject,
  startPreview: mocks.startPreview,
  stopPreview: mocks.stopPreview,
  installWebDependencies: mocks.installWebDependencies,
  savePreviewConfig: mocks.savePreviewConfig,
  dismissPreviews: mocks.dismissPreviews,
  openPreviewWindow: mocks.openPreviewWindow,
  readyPreviewUrl: mocks.readyPreviewUrl,
}))
vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: () => () => undefined }))
vi.mock('@wailsio/runtime', () => ({ Browser: { OpenURL: vi.fn() } }))
vi.mock('@/stores/goideLsp', () => ({ useGoIDELspStore: { getState: () => ({ showToolWindow: mocks.showToolWindow }) } }))
vi.mock('@/stores/goideToast', () => ({ studioToast: vi.fn() }))

import { selectSessionPreview, useLivePreviewStore } from './livePreview'

const target = (patch: Record<string, unknown>) => ({
  dir: '/p', relative: '.', name: 'app', kind: 'node', tool: 'vite', framework: 'react', packageManager: 'npm', lockfile: true,
  devScript: 'dev', dependenciesInstalled: true, entryHtml: 'index.html', ...patch,
})
const report = (targets: unknown[], config?: unknown) => ({ targets, runtime: {}, servers: [], previews: [], trusted: true, config })
const started = (patch: Record<string, unknown> = {}) => ({ id: 'dev:.:dev', sessionId: 's1', mode: 'devserver', state: 'starting', url: '', root: '/p', bridged: false, startedAt: '2026-10-17T10:00:00Z', ...patch })

const view = () => selectSessionPreview(useLivePreviewStore.getState(), 's1')

beforeEach(() => {
  vi.clearAllMocks()
  useLivePreviewStore.setState({ bySession: {} })
  mocks.savePreviewConfig.mockResolvedValue(undefined)
  mocks.dismissPreviews.mockResolvedValue(undefined)
})

describe('live preview store', () => {
  it('starts the only dev server straight away and shows the preview in the split', async () => {
    mocks.detectWebProject.mockResolvedValue(report([target({})]))
    mocks.startPreview.mockResolvedValue(started())
    await useLivePreviewStore.getState().goLive('s1')
    expect(mocks.startPreview).toHaveBeenCalledWith('s1', { mode: 'devserver', dir: '.', script: 'dev' })
    expect(view().visible).toBe(true)
    expect(view().activeId).toBe('dev:.:dev')
    expect(view().lastRequest).toEqual({ mode: 'devserver', dir: '.', script: 'dev' })
  })

  it('asks which target to run in a monorepo and shows the question', async () => {
    mocks.detectWebProject.mockResolvedValue(report([target({ relative: 'apps/web' }), target({ relative: 'apps/admin' })]))
    await useLivePreviewStore.getState().goLive('s1')
    expect(mocks.startPreview).not.toHaveBeenCalled()
    expect(view().chooserOpen).toBe(true)
    expect(view().visible).toBe(true)
  })

  it('shows the explanation when a project has nothing to preview', async () => {
    mocks.detectWebProject.mockResolvedValue(report([]))
    await useLivePreviewStore.getState().goLive('s1')
    expect(view().error).toMatch(/Nothing to preview/)
    expect(view().visible).toBe(true)
  })

  it('keeps the server error visible instead of swallowing it', async () => {
    mocks.detectWebProject.mockResolvedValue(report([target({})]))
    mocks.startPreview.mockRejectedValue(new Error('trust the project first'))
    await useLivePreviewStore.getState().goLive('s1')
    expect(view().error).toBe('trust the project first')
    expect(view().starting).toBe(false)
    expect(view().visible).toBe(true)
  })

  it('upserts preview.status events by id', () => {
    const store = useLivePreviewStore.getState()
    store.handleEvent({ version: 1, type: 'preview.status', sessionId: 's1', sequence: 1, timestamp: '', payload: started() })
    store.handleEvent({ version: 1, type: 'preview.status', sessionId: 's1', sequence: 2, timestamp: '', payload: started({ state: 'ready', url: 'http://127.0.0.1:5500/' }) })
    expect(view().previews).toHaveLength(1)
    expect(view().previews[0].state).toBe('ready')
  })

  it('resumes Go Live after a confirmed dependency install finishes', async () => {
    mocks.detectWebProject.mockResolvedValue(report([target({})]))
    mocks.startPreview.mockResolvedValue(started())
    mocks.installWebDependencies.mockResolvedValue({ id: 'run-1' })
    const resume = { mode: 'devserver', dir: '.', script: 'dev' }
    await useLivePreviewStore.getState().installDependencies('s1', '.', resume)
    expect(mocks.installWebDependencies).toHaveBeenCalledWith('s1', '.')
    expect(view().install?.runId).toBe('run-1')
    useLivePreviewStore.getState().handleEvent({ version: 1, type: 'run.finished', sessionId: 's1', sequence: 3, timestamp: '', payload: { id: 'run-1', status: 'exited', exitCode: 0 } })
    await vi.waitFor(() => expect(mocks.startPreview).toHaveBeenCalledWith('s1', resume))
    expect(view().install).toBeNull()
  })

  it('does not resume after a failed install and says so', async () => {
    mocks.installWebDependencies.mockResolvedValue({ id: 'run-2' })
    await useLivePreviewStore.getState().installDependencies('s1', '.', { mode: 'devserver', dir: '.' })
    useLivePreviewStore.getState().handleEvent({ version: 1, type: 'run.finished', sessionId: 's1', sequence: 4, timestamp: '', payload: { id: 'run-2', status: 'failed', exitCode: 1 } })
    expect(mocks.startPreview).not.toHaveBeenCalled()
    expect(view().error).toMatch(/install failed/)
  })

  it('remembers placement and viewport (debounced) without touching what to run', async () => {
    vi.useFakeTimers()
    try {
      const store = useLivePreviewStore.getState()
      store.setViewport('s1', { device: 'tablet' })
      store.setPlacement('s1', 'tab')
      store.setAutoReload('s1', false)
      expect(mocks.savePreviewConfig).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(500)
      expect(mocks.savePreviewConfig).toHaveBeenCalledTimes(1)
      expect(mocks.savePreviewConfig).toHaveBeenCalledWith('s1', expect.objectContaining({ placement: 'tab', device: 'tablet', autoReload: false }))
      expect(mocks.savePreviewConfig.mock.calls[0][1]).not.toHaveProperty('mode')
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores the saved preferences once, then the UI is the source of truth', async () => {
    mocks.detectWebProject.mockResolvedValue(report([target({})], { mode: 'devserver', dir: '.', placement: 'tab', device: 'mobile', width: 500, height: 0, autoReload: false }))
    await useLivePreviewStore.getState().load('s1')
    expect(view()).toMatchObject({ placement: 'tab', device: 'mobile', autoReload: false })
    useLivePreviewStore.getState().setPlacement('s1', 'panel')
    mocks.detectWebProject.mockResolvedValue(report([target({})], { mode: 'devserver', dir: '.', placement: 'tab', device: 'mobile', width: 500, height: 0, autoReload: false }))
    await useLivePreviewStore.getState().load('s1')
    expect(view().placement).toBe('panel')
  })

  it('placing the preview in the panel opens the tool window, not the split', () => {
    useLivePreviewStore.getState().show('s1', 'panel')
    expect(mocks.showToolWindow).toHaveBeenCalledWith('preview')
    expect(view().visible).toBe(false)
  })
})
