import { Events } from '@wailsio/runtime'
import * as LoadTest from '../../bindings/github.com/Andrea-Cavallo/adOmnia/loadtest'
import type { FlowInput, Plan, Scenario, Workload } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/loadtest/models'
import type { HTTPExecPayload } from '@/lib/requestExecutionContract'

export type LoadTestWorkload = Workload
export type LoadTestPlan = Plan
export type LoadTestFlowInput = FlowInput

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

export interface LoadTestErrorGroup { code: string; message: string; count: number; steps?: string[]; status?: number }

export interface LoadTestStep {
  id: string
  step: string
  count: number
  errors: number
  errorPct: number
  minMs: number
  avgMs: number
  p50Ms: number
  p90Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
  statusCodes: Record<string, number>
}

export interface LoadTestBin { fromMs: number; toMs: number; count: number; percentage: number; overflow?: boolean }

export interface LoadTestApdex { thresholdMs: number; satisfied: number; tolerated: number; frustrated: number; score: number }

export interface LoadTestTimelinePoint {
  startMs?: number
  timeMs: number
  latencyMs: number
  status: number
  ok: boolean
  step?: string
  stepId?: string
  vu?: number
  iteration?: number
  bytes?: number
  measured?: boolean
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
  iterations?: number
  failedIterations?: number
  /** Arrivals the open model could not start: every VU of the pool was busy. */
  droppedIterations?: number
  /** p99 of how late open-model iterations started; above ~10 ms the generator is saturated. */
  schedulerLagP99Ms?: number
  measuredTimeMs?: number
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
  steps?: LoadTestStep[]
  distribution?: LoadTestBin[]
  apdex?: LoadTestApdex
  gateFailures?: string[]
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
  stageLabel?: string
  measuring: boolean
  iterations: number
  dropped?: number
  sent: number
  failed: number
  rps: number
  p95Ms: number
  errorRate: number
  last: LoadTestBucket
  /** The result so far, without the per-request timeline. */
  snapshot?: LoadTestResult
}

interface Finished { runId: string; result?: LoadTestResult; error?: string }

export interface LoadTestRun {
  /** Resolves with the result (aborted after stop) or rejects when the run could not start. */
  result: Promise<LoadTestResult>
  stop: () => void
}

/** Runs one resolved request on the Go engine. */
export function runLoadTest(request: HTTPExecPayload, workload: LoadTestWorkload, onProgress: (p: LoadTestProgress) => void, name?: string): LoadTestRun {
  const scenario: Scenario = { name, request, workload }
  return startOnEngine(() => LoadTest.Start(scenario), onProgress)
}

/** Runs a Flow Builder stress plan — the file `adomnia stress` runs in CI — on the Go engine. */
export function runStressPlan(plan: LoadTestPlan, input: LoadTestFlowInput, onProgress: (p: LoadTestProgress) => void): LoadTestRun {
  return startOnEngine(() => LoadTest.StartPlan(plan, input), onProgress)
}

/**
 * Starts a run and follows its events. Events are buffered until the run id arrives, so a
 * run that finishes before Start returns (a fast probe) is not lost.
 */
function startOnEngine(start: () => Promise<string>, onProgress: (p: LoadTestProgress) => void): LoadTestRun {
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
    start().then((id) => {
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
