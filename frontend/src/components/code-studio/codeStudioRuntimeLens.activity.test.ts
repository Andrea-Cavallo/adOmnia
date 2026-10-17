import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/monacoSetup', () => ({ monaco: {
  Emitter: class { event = vi.fn(); fire = vi.fn() },
  editor: { registerCommand: vi.fn() }, languages: { registerCodeLensProvider: vi.fn() },
} }))
vi.mock('@/stores/codeStudio', () => ({ useCodeStudioStore: { getState: () => ({ sessions: [] }) } }))
vi.mock('@/stores/codeStudioRuntimeProfile', () => ({ useCodeStudioRuntimeProfile: { getState: () => ({ costs: {} }), subscribe: vi.fn() } }))
vi.mock('./codeStudioLanguageFeatures', () => ({ documentForModel: () => undefined }))
vi.mock('@/lib/useServerPort', () => ({ getServerPort: async () => 1 }))
vi.mock('@/lib/otlp-api', () => ({ getOtlpLens: vi.fn() }))
import { getOtlpLens } from '@/lib/otlp-api'
import { useActivityStore } from '@/stores/activity'
import { registerCodeStudioRuntimeLens } from './codeStudioRuntimeLens'
afterEach(() => { useActivityStore.getState().setPhase('Background'); vi.useRealTimers(); vi.unstubAllGlobals() })
it('shares an in-flight poll across rapid idle/resume and parks the loop in background', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  vi.stubGlobal('document', { hidden: false })
  vi.stubGlobal('localStorage', { getItem: () => null })
  useActivityStore.setState({ phase: 'Active', scopes: ['goide'], retained: {} })
  let resolve!: (value: []) => void
  vi.mocked(getOtlpLens).mockImplementation(() => new Promise(done => { resolve = done }))
  registerCodeStudioRuntimeLens()
  await vi.advanceTimersByTimeAsync(0)
  useActivityStore.getState().setPhase('Idle'); useActivityStore.getState().setPhase('Active')
  expect(getOtlpLens).toHaveBeenCalledTimes(1)
  resolve([]); await vi.advanceTimersByTimeAsync(0)
  expect(vi.getTimerCount()).toBe(1)
  useActivityStore.getState().setPhase('Background')
  await vi.advanceTimersByTimeAsync(30 * 60_000)
  expect(getOtlpLens).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
})
