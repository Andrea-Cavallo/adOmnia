import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('./activity-api', () => ({ reportActivity: vi.fn(async () => undefined), removeActivity: vi.fn(async () => undefined) }))
import { startActivityTracking } from './activityTracking'
import { reportActivity } from './activity-api'
import { IDLE_AFTER_MS, useActivityStore } from '@/stores/activity'
import { useAppStore } from '@/stores/app'
let stop: (() => void) | undefined
let windowListeners: Map<string, Set<(event: Event) => void>>
let documentListeners: Map<string, Set<(event: Event) => void>>
let hidden: { hidden: boolean }
const fire = (target: Map<string, Set<(event: Event) => void>>, type: string, trusted = true) => {
  for (const listener of target.get(type) ?? []) listener({ type, isTrusted: trusted } as Event)
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(10_000); vi.mocked(reportActivity).mockClear()
  windowListeners = new Map(); documentListeners = new Map()
  const events = (listeners: typeof windowListeners) => ({
    addEventListener: (type: string, listener: (event: Event) => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener) },
    removeEventListener: (type: string, listener: (event: Event) => void) => { listeners.get(type)?.delete(listener) },
  })
  hidden = { hidden: false }
  vi.stubGlobal('document', Object.assign(hidden, events(documentListeners)))
  vi.stubGlobal('window', { ...events(windowListeners), location: { search: '' }, setTimeout, clearTimeout })
  useAppStore.setState({ activeRail: 'collections', splitView: false })
  useActivityStore.setState({ phase: 'Active', scopes: [], retained: {} })
})
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals() })
it('enters Idle at five minutes, resumes on trusted input, with no per-keystroke RPC or render', async () => {
  stop = startActivityTracking(); await Promise.resolve()
  const notifications = vi.fn(), off = useActivityStore.subscribe(notifications)
  for (let i = 0; i < 100; i++) fire(windowListeners, 'keydown')
  expect(notifications).not.toHaveBeenCalled(); expect(reportActivity).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(IDLE_AFTER_MS - 1); expect(useActivityStore.getState().phase).toBe('Active')
  vi.advanceTimersByTime(1); expect(useActivityStore.getState().phase).toBe('Idle')
  expect(vi.getTimerCount()).toBe(0)
  fire(windowListeners, 'keydown', false); expect(useActivityStore.getState().phase).toBe('Idle')
  fire(windowListeners, 'keydown'); expect(useActivityStore.getState().phase).toBe('Active')
  expect(vi.getTimerCount()).toBe(1); off()
})
it('reports background visibility and restores immediately on return', () => {
  stop = startActivityTracking()
  hidden.hidden = true; fire(documentListeners, 'visibilitychange')
  expect(useActivityStore.getState().phase).toBe('Background'); expect(vi.getTimerCount()).toBe(0)
  hidden.hidden = false; fire(documentListeners, 'visibilitychange')
  expect(useActivityStore.getState().phase).toBe('Active'); expect(vi.getTimerCount()).toBe(1)
})
it('keeps exact workspace scopes reference-counted and supports split navigation', () => {
  stop = startActivityTracking()
  const releaseA = useActivityStore.getState().retain('code-studio:a')
  const releaseB = useActivityStore.getState().retain('code-studio:a')
  useAppStore.setState({ splitView: true, activeRail: 'codestudio' })
  expect(useActivityStore.getState().scopes).toEqual(['code-studio:a', 'codestudio', 'collections'])
  releaseA(); expect(useActivityStore.getState().scopes).toContain('code-studio:a')
  releaseB(); expect(useActivityStore.getState().scopes).not.toContain('code-studio:a')
})
it('unsubscribes inputs, deadlines and store listeners when tracking stops', () => {
  stop = startActivityTracking(); stop(); stop = undefined
  expect(vi.getTimerCount()).toBe(0)
  expect([...windowListeners.values()].every(listeners => !listeners.size)).toBe(true)
  expect([...documentListeners.values()].every(listeners => !listeners.size)).toBe(true)
})
