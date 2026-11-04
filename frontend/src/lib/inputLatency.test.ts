import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@wailsio/runtime', () => ({ Call: { ByName: vi.fn() } }))
import { Call } from '@wailsio/runtime'
import {
  maybeStartInputLatencyCapture,
  startInputLatencyCapture,
  stopInputLatencyCapture,
} from './inputLatency'

const byName = Call.ByName as unknown as ReturnType<typeof vi.fn>

let now = 0
let listeners: Record<string, (event: Event) => void> = {}
let rafQueue: Array<(time: number) => void> = []
let intervalCallback: (() => void) | null = null
let observerCallback: ((list: { getEntries: () => Array<{ duration: number }> }) => void) | null = null
let observedEntryTypes: string[] = []

class FakePerformanceObserver {
  constructor(callback: (list: { getEntries: () => Array<{ duration: number }> }) => void) {
    observerCallback = callback
  }
  observe(options: { entryTypes: string[] }) {
    observedEntryTypes = options.entryTypes
  }
  disconnect() {
    observerCallback = null
  }
}

function flushFrames() {
  while (rafQueue.length) {
    now += 10
    rafQueue.shift()?.(now)
  }
}

beforeEach(() => {
  now = 0
  listeners = {}
  rafQueue = []
  intervalCallback = null
  observerCallback = null
  observedEntryTypes = []
  vi.resetAllMocks()
  vi.stubGlobal('performance', { now: () => now })
  vi.stubGlobal('PerformanceObserver', FakePerformanceObserver)
  vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
    rafQueue.push(callback)
    return rafQueue.length
  })
  vi.stubGlobal('document', {
    hidden: false,
    addEventListener: (type: string, callback: (event: Event) => void) => { listeners[type] = callback },
    removeEventListener: (type: string) => { delete listeners[type] },
  })
  vi.stubGlobal('window', {
    setInterval: (callback: () => void) => { intervalCallback = callback; return 1 },
    clearInterval: () => { intervalCallback = null },
  })
})

afterEach(() => {
  stopInputLatencyCapture()
})

it('stays inert while no scenario recording is active', async () => {
  byName.mockResolvedValue('{"active":false}')
  await expect(maybeStartInputLatencyCapture()).resolves.toBe(false)
  expect(byName).toHaveBeenCalledWith('main.App.PerfRecordingStatus')
  expect(listeners.keydown).toBeUndefined()
})

it('measures keypress to paint and pushes percentiles to the recording', async () => {
  byName.mockImplementation(async (method: string) =>
    method === 'main.App.PerfRecordingStatus' ? '{"active":true,"scenario":"typing"}' : undefined)
  await expect(maybeStartInputLatencyCapture()).resolves.toBe(true)
  expect(listeners.keydown).toBeTypeOf('function')

  now = 100
  listeners.keydown({ timeStamp: 100 } as Event)
  flushFrames()
  now = 400
  listeners.keydown({ timeStamp: 400 } as Event)
  flushFrames()

  intervalCallback?.()
  await vi.waitFor(() => expect(byName).toHaveBeenCalledWith('main.App.PerfPushFrontendMetrics', expect.any(String)))
  const payload = JSON.parse(byName.mock.calls.find((call: unknown[]) => call[0] === 'main.App.PerfPushFrontendMetrics')?.[1] as string)
  expect(payload.inputSamples).toBe(2)
  expect(payload.inputKeypresses).toBe(2)
  expect(payload.inputP50Ms).toBe(20)
  expect(payload.inputP95Ms).toBe(20)
  expect(payload.inputP99Ms).toBe(20)
  expect(payload.inputMaxMs).toBe(20)
})

it('counts renderer long tasks and ignores implausible entries', async () => {
  byName.mockImplementation(async (method: string) =>
    method === 'main.App.PerfRecordingStatus' ? '{"active":true,"scenario":"typing"}' : undefined)
  await maybeStartInputLatencyCapture()
  expect(observedEntryTypes).toEqual(['longtask'])

  observerCallback?.({ getEntries: () => [{ duration: 60 }, { duration: 120.5 }, { duration: 0 }, { duration: -5 }, { duration: 90_000 }] })
  now = 10
  listeners.keydown({ timeStamp: 10 } as Event)
  flushFrames()

  intervalCallback?.()
  await vi.waitFor(() => expect(byName).toHaveBeenCalledWith('main.App.PerfPushFrontendMetrics', expect.any(String)))
  const payload = JSON.parse(byName.mock.calls.find((call: unknown[]) => call[0] === 'main.App.PerfPushFrontendMetrics')?.[1] as string)
  expect(payload.longTasks).toBe(2)
  expect(payload.longTaskTotalMs).toBe(180.5)
  expect(payload.longTaskMaxMs).toBe(120.5)

  // Each window reports its own long tasks: the next push must not repeat them.
  intervalCallback?.()
  await vi.waitFor(() => expect(byName.mock.calls.filter((call: unknown[]) => call[0] === 'main.App.PerfPushFrontendMetrics')).toHaveLength(1))
})

it('flushes remaining metrics and detaches on stop', async () => {
  byName.mockResolvedValue(undefined)
  startInputLatencyCapture()
  now = 50
  listeners.keydown({ timeStamp: 50 } as Event)
  flushFrames()
  stopInputLatencyCapture()
  await vi.waitFor(() => expect(byName).toHaveBeenCalledWith('main.App.PerfPushFrontendMetrics', expect.any(String)))
  expect(listeners.keydown).toBeUndefined()
  expect(intervalCallback).toBeNull()
  expect(observerCallback).toBeNull()
})
