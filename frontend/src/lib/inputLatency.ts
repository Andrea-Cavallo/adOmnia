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
  inputMaxMs: number
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
  stopCapture = () => {
    document.removeEventListener('keydown', onKeydown)
    window.clearInterval(report)
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
  if (samples.length === 0 && keypresses === 0) return
  const sorted = [...samples].sort((a, b) => a - b)
  const metrics: InputLatencyMetrics = {
    inputSamples: sorted.length,
    inputKeypresses: keypresses,
    inputP50Ms: round(percentile(sorted, 50)),
    inputP95Ms: round(percentile(sorted, 95)),
    inputMaxMs: round(sorted.length ? sorted[sorted.length - 1] : 0),
  }
  samples = []
  keypresses = 0
  try {
    await Call.ByName('main.App.PerfPushFrontendMetrics', JSON.stringify(metrics))
  } catch {
    // Local instrumentation must never break the application.
  }
}
