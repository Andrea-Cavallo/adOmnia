import { Events } from '@wailsio/runtime'
import * as LoadTest from '../../bindings/github.com/Andrea-Cavallo/adOmnia/loadtest'
import type { Comparison, FlowInput, Gates, Plan, RunSummary, Scenario, ScenarioFile, ScenarioFileEntry, Workload } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/loadtest/models'
import type { HTTPExecPayload } from '@/lib/requestExecutionContract'

export type LoadTestWorkload = Workload
export type LoadTestPlan = Plan
export type LoadTestFlowInput = FlowInput
export type LoadTestGates = Gates
export type LoadTestRunSummary = RunSummary
export type LoadTestComparison = Comparison
export type LoadTestScenarioFile = ScenarioFile
export type LoadTestScenarioFileEntry = ScenarioFileEntry
export type LoadTestReportFormat = 'json' | 'md' | 'html' | 'junit' | 'csv' | 'samples'

/** The conditions of a run: same scenarioHash = same test, seed replays the random values. */
export interface LoadTestManifest {
  appVersion: string
  commit?: string
  scenarioHash: string
  datasetHash?: string
  datasetRows?: number
  seed: number
  target: 'request' | 'flow' | 'grpc' | string
  targetLabel: string
  os: string
  arch: string
  cpus: number
  goVersion: string
  vars?: Record<string, string>
  saturated?: boolean
}

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
  /** Set when a gate with abortOnFail stopped the run. */
  abortReason?: string
  manifest?: LoadTestManifest
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

interface Finished { runId: string; result?: LoadTestResult; error?: string; saved?: RunSummary }

export interface LoadTestRun {
  /** Resolves with the result (aborted after stop) or rejects when the run could not start. */
  result: Promise<LoadTestResult>
  stop: () => void
}

/** Runs one resolved request on the Go engine. */
export function runLoadTest(request: HTTPExecPayload, workload: LoadTestWorkload, onProgress: (p: LoadTestProgress) => void, name?: string, gates?: Gates): LoadTestRun {
  const scenario: Scenario = { name, request, workload, gates }
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

/** Runs a scenario file (the one Git shares and `adomnia stress` runs) with the app's variables. */
export function runScenarioFile(file: LoadTestScenarioFile, input: LoadTestFlowInput, onProgress: (p: LoadTestProgress) => void): LoadTestRun {
  return startOnEngine(() => LoadTest.StartFile(file, input), onProgress)
}

// The run history (bbolt): every finished run lands there by itself.
export const listRuns = async (): Promise<LoadTestRunSummary[]> => (await LoadTest.Runs()) ?? []
export const loadRun = (id: string): Promise<LoadTestResult> => LoadTest.Run(id) as unknown as Promise<LoadTestResult>
export const deleteRun = (id: string): Promise<void> => LoadTest.DeleteRun(id)
export const importRun = (result: LoadTestResult): Promise<LoadTestRunSummary> => LoadTest.ImportRun(result as never)

/** base → head; tolerance in percent (0 = 10%). */
export const compareRuns = (baseId: string, headId: string, tolerancePct = 0): Promise<LoadTestComparison> => LoadTest.Compare(baseId, headId, tolerancePct)
export const compareResults = (base: LoadTestResult, head: LoadTestResult, tolerancePct = 0): Promise<LoadTestComparison> => LoadTest.CompareResults(base as never, head as never, tolerancePct)

/** A report rendered by the engine from the canonical result. */
export const renderReport = (result: LoadTestResult, format: LoadTestReportFormat): Promise<string> => LoadTest.Report(result as never, format)

// Scenario files: <folder>/.adomnia/loadtests/<name>.loadtest.json
export const saveScenarioFile = (folder: string, file: LoadTestScenarioFile): Promise<string> => LoadTest.SaveScenarioFile(folder, file)
export const listScenarioFiles = async (folder: string): Promise<LoadTestScenarioFileEntry[]> => (await LoadTest.ScenarioFiles(folder)) ?? []
export const readScenarioFile = (path: string): Promise<LoadTestScenarioFile> => LoadTest.ReadScenarioFile(path)
export const planScenarioFile = (plan: LoadTestPlan): Promise<LoadTestScenarioFile> => LoadTest.PlanScenarioFile(plan)

// The drawer's settings saved by name.
export const listSavedSettings = async (): Promise<string[]> => (await LoadTest.SavedSettings()) ?? []
export const saveSettings = (name: string, config: Record<string, unknown>): Promise<void> => LoadTest.SaveSettings(name, config)
export async function loadSettings(name: string): Promise<Record<string, unknown>> {
  const value: unknown = await LoadTest.LoadSettings(name)
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

const FOLDER_KEY = 'adomnia.loadtest.folder'
/** The workspace folder scenario files are saved in, remembered per machine. */
export function scenarioFolder(): string {
  try { return localStorage.getItem(FOLDER_KEY) ?? '' } catch { return '' }
}
export function rememberScenarioFolder(folder: string): void {
  try { localStorage.setItem(FOLDER_KEY, folder) } catch { /* private mode: asked again next time */ }
}

/** Runs one gRPC call (internal/grpc request shape) on the engine: same metrics, history and reports as HTTP. */
export function runGrpcLoadTest(call: Record<string, unknown>, workload: LoadTestWorkload, onProgress: (p: LoadTestProgress) => void, name?: string, gates?: Gates): LoadTestRun {
  const scenario = { name, grpc: call, workload, gates } as unknown as Scenario
  return startOnEngine(() => LoadTest.Start(scenario), onProgress)
}
