import { Events } from '@wailsio/runtime'
import * as LoadTest from '../../bindings/github.com/Andrea-Cavallo/adOmnia/loadtest'
import type { Scenario, Workload } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/loadtest/models'
import type { HTTPExecPayload } from '@/lib/requestExecutionContract'

export type LoadTestWorkload = Workload

/** One second of a run (measured requests only). */
export interface LoadTestBucket {
  second: number
  reqs: number
  errors: number
  avgMs: number
  p95Ms: number
  p99Ms: number
  vus: number
}

export interface LoadTestErrorGroup { code: string; message: string; count: number }

export interface LoadTestTimelinePoint {
  startMs?: number
  timeMs: number
  latencyMs: number
  status: number
  ok: boolean
  error?: string
}

/** The engine's report (internal/loadtest Result). */
export interface LoadTestResult {
  name?: string
  executor?: string
  startedAt?: string
  endedAt?: string
  aborted?: boolean
  totalRequests: number
  successful: number
  failed: number
  warmupSkipped?: number
  bytesReceived?: number
  maxVUs?: number
  totalTimeMs: number
  avgMs: number
  minMs: number
  maxMs: number
  p50Ms: number
  p75Ms: number
  p90Ms: number
  p95Ms: number
  p99Ms: number
  p999Ms: number
  throughput: number
  errorRate: number
  statusCodes: Record<number, number>
  errorGroups?: LoadTestErrorGroup[]
  timeline?: LoadTestTimelinePoint[]
  timelineTruncated?: boolean
  throughputTimeline?: LoadTestBucket[]
}

/** The live view, once per second. */
export interface LoadTestProgress {
  runId: string
  elapsedS: number
  vus: number
  stage: number
  measuring: boolean
  sent: number
  failed: number
  rps: number
  p95Ms: number
  errorRate: number
  last: LoadTestBucket
}

interface Finished { runId: string; result?: LoadTestResult; error?: string }

export interface LoadTestRun {
  /** Resolves with the result (aborted after stop) or rejects when the run could not start. */
  result: Promise<LoadTestResult>
  stop: () => void
}

/**
 * Starts a run on the Go engine. Events are buffered until Start returns the run id, so a
 * run that finishes before the id arrives (a fast probe) is not lost.
 */
export function runLoadTest(request: HTTPExecPayload, workload: LoadTestWorkload, onProgress: (p: LoadTestProgress) => void, name?: string): LoadTestRun {
  let runId = ''
  let stopRequested = false
  const early: { name: string; data: unknown }[] = []
  const unsubscribers: (() => void)[] = []

  const result = new Promise<LoadTestResult>((resolve, reject) => {
    const cleanup = () => unsubscribers.forEach((off) => off())
    const handle = (eventName: string, data: unknown) => {
      if (eventName === 'loadtest:progress') {
        const p = data as LoadTestProgress
        if (p.runId === runId) onProgress(p)
        return
      }
      const f = data as Finished
      if (f.runId !== runId) return
      cleanup()
      if (f.result) resolve(f.result)
      else reject(new Error(f.error || 'Load test failed'))
    }
    for (const eventName of ['loadtest:progress', 'loadtest:finished']) {
      unsubscribers.push(Events.On(eventName, (event) => {
        if (runId) handle(eventName, event.data)
        else early.push({ name: eventName, data: event.data })
      }))
    }
    const scenario: Scenario = { name, request, workload }
    LoadTest.Start(scenario).then((id) => {
      runId = id
      if (stopRequested) void LoadTest.Stop(id)
      early.splice(0).forEach((e) => handle(e.name, e.data))
    }, (e: unknown) => {
      cleanup()
      reject(e instanceof Error ? e : new Error(String(e)))
    })
  })

  return {
    result,
    stop: () => {
      stopRequested = true
      if (runId) void LoadTest.Stop(runId)
    },
  }
}
