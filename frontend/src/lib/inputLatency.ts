// Input-latency capture for the local performance baseline protocol
// (docs/PERFORMANCE.md). The module stays completely inert unless a scenario
// recording is active (ADOMNIA_PERF_SCENARIO); measurements live in memory and
// are only merged into the local scenario recording through
// main.App.PerfPushFrontendMetrics. No telemetry, no remote calls.
import { Call } from '@wailsio/runtime'

export interface InputLatencyMetrics {
  inputSamples: number
  inputKeypresses: number
  inputP50Ms: number
  inputP95Ms: number
  inputP99Ms: number
  inputMaxMs: number
  longTasks: number
  longTaskTotalMs: number
  longTaskMaxMs: number
}

interface RecordingStatus {
  active: boolean
  scenario?: string
  path?: string
}

const MAX_SAMPLES = 512
const REPORT_INTERVAL_MS = 5000
const MAX_PLAUSIBLE_MS = 60_000

let samples: number[] = []
let keypresses = 0
let longTasks = 0
let longTaskTotalMs = 0
let longTaskMaxMs = 0
let longTaskObserver: PerformanceObserver | null = null
let stopCapture: (() => void) | null = null

async function recordingStatus(): Promise<RecordingStatus> {
  try {
    const raw = (await Call.ByName('main.App.PerfRecordingStatus')) as unknown
    if (typeof raw === 'string') return JSON.parse(raw) as RecordingStatus
    if (raw && typeof raw === 'object') return raw as RecordingStatus
  } catch {
    // Browser development or an older build: no recording is available.
  }
  return { active: false }
}

/** Enables capture only while a scenario recording is active. */
export async function maybeStartInputLatencyCapture(): Promise<boolean> {
  const status = await recordingStatus()
  if (!status.active) return false
  startInputLatencyCapture()
  return true
}

/**
 * Counts renderer long tasks (a task holding the main thread for 50 ms or more).
 * They explain an input p95 without a matching backend cost, and are the closest
 * local signal for dropped frames: a browser that supports neither the entry type
 * nor PerformanceObserver records nothing instead of failing.
 */
function startLongTaskCapture(): void {
  if (longTaskObserver || typeof PerformanceObserver === 'undefined') return
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = entry.duration
        if (!Number.isFinite(duration) || duration <= 0 || duration >= MAX_PLAUSIBLE_MS) continue
        longTasks++
        longTaskTotalMs += duration
        if (duration > longTaskMaxMs) longTaskMaxMs = duration
      }
    })
    longTaskObserver.observe({ entryTypes: ['longtask'] })
  } catch {
    longTaskObserver = null
  }
}

/** Measures keypress → paint with a double requestAnimationFrame. */
export function startInputLatencyCapture(): () => void {
  if (stopCapture) return stopCapture
  const onKeydown = (event: Event) => {
    if (document.hidden) return
    const started = event.timeStamp > 0 ? event.timeStamp : performance.now()
    keypresses++
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const elapsed = performance.now() - started
        if (elapsed >= 0 && elapsed < MAX_PLAUSIBLE_MS) {
          samples.push(elapsed)
          if (samples.length > MAX_SAMPLES) samples.shift()
        }
      })
    })
  }
  const report = window.setInterval(() => { void pushInputLatencyMetrics() }, REPORT_INTERVAL_MS)
  document.addEventListener('keydown', onKeydown, { passive: true })
  startLongTaskCapture()
  stopCapture = () => {
    document.removeEventListener('keydown', onKeydown)
    window.clearInterval(report)
    longTaskObserver?.disconnect()
    longTaskObserver = null
    stopCapture = null
    void pushInputLatencyMetrics()
  }
  return stopCapture
}

export function stopInputLatencyCapture(): void {
  stopCapture?.()
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** Pushes the current window into the active recording; a no-op otherwise. */
export async function pushInputLatencyMetrics(): Promise<void> {
  if (samples.length === 0 && keypresses === 0 && longTasks === 0) return
  const sorted = [...samples].sort((a, b) => a - b)
  const metrics: InputLatencyMetrics = {
    inputSamples: sorted.length,
    inputKeypresses: keypresses,
    inputP50Ms: round(percentile(sorted, 50)),
    inputP95Ms: round(percentile(sorted, 95)),
    inputP99Ms: round(percentile(sorted, 99)),
    inputMaxMs: round(sorted.length ? sorted[sorted.length - 1] : 0),
    longTasks,
    longTaskTotalMs: round(longTaskTotalMs),
    longTaskMaxMs: round(longTaskMaxMs),
  }
  samples = []
  keypresses = 0
  longTasks = 0
  longTaskTotalMs = 0
  longTaskMaxMs = 0
  try {
    await Call.ByName('main.App.PerfPushFrontendMetrics', JSON.stringify(metrics))
  } catch {
    // Local instrumentation must never break the application.
  }
}
